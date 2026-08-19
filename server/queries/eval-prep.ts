import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { classifySourceLink, type SourceLinkState } from "@/lib/external/source-link-state"
import {
  classifyEvalPrep,
  MAIN_REVIEW_SOURCES,
  type EvalPrep,
  type MainReviewSource,
} from "@/lib/ai-evaluation/eval-readiness"

type AdminClient = ReturnType<typeof createAdminClient>

/** Ver o comentário de CHUNK_SIZE em app/curation/works/page.tsx: `.in()` com 500+ uuids
 *  estoura o limite de URL do PostgREST e a request fica pendurada até dar timeout. */
const CHUNK = 200

interface WorkPrepRow {
  id: string
  tags_inferred_at: string | null
  review_digest_at: string | null
  review_summary_at: string | null
}

interface ExtIdRow {
  work_id: string
  source: string
  external_id: string | null
  is_rejected: boolean | null
}

function chunks<T>(a: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n))
  return out
}

/**
 * Prontidão de preparo das obras exibidas na fila de IA Atributos.
 *
 * Duas leituras, as duas escopadas por `work_id` E paginadas: 500 obras × 2 fontes
 * principais dão **exatamente 1000 linhas** em `work_external_ids` — em cima do corte
 * silencioso do PostgREST, que devolveria o recorte sem erro e faria obra vinculada
 * parecer lacuna (bloqueando a avaliação dela). O chunk de 200 já mantém cada request
 * em ≤400 linhas; o `.range()` é a rede que não depende desse número continuar verdade.
 */
export async function loadEvalPrep(
  ids: string[],
  client?: AdminClient,
): Promise<Map<string, EvalPrep>> {
  const out = new Map<string, EvalPrep>()
  if (ids.length === 0) return out
  const supabase = client ?? createAdminClient()

  const [workRows, extRows] = await Promise.all([
    (async () => {
      const acc: WorkPrepRow[] = []
      for (const chunk of chunks(ids, CHUNK)) {
        acc.push(
          ...(await fetchAllRows<WorkPrepRow>(
            (from, to) =>
              supabase
                .from("works")
                .select("id, tags_inferred_at, review_digest_at, review_summary_at")
                .in("id", chunk)
                .range(from, to),
            "evalPrep.works",
          )),
        )
      }
      return acc
    })(),
    (async () => {
      const acc: ExtIdRow[] = []
      for (const chunk of chunks(ids, CHUNK)) {
        acc.push(
          ...(await fetchAllRows<ExtIdRow>(
            (from, to) =>
              supabase
                .from("work_external_ids")
                .select("work_id, source, external_id, is_rejected")
                .in("work_id", chunk)
                .in("source", MAIN_REVIEW_SOURCES as unknown as string[])
                .range(from, to),
            "evalPrep.externalIds",
          )),
        )
      }
      return acc
    })(),
  ])

  const statesByWork = new Map<string, Partial<Record<MainReviewSource, SourceLinkState>>>()
  for (const row of extRows) {
    const source = row.source as MainReviewSource
    if (!(MAIN_REVIEW_SOURCES as readonly string[]).includes(source)) continue
    const map = statesByWork.get(row.work_id) ?? {}
    map[source] = classifySourceLink(row)
    statesByWork.set(row.work_id, map)
  }

  const byId = new Map(workRows.map((w) => [w.id, w]))
  for (const id of ids) {
    const w = byId.get(id)
    out.set(
      id,
      classifyEvalPrep({
        sourceStates: statesByWork.get(id) ?? {},
        // Obra que sumiu entre a fila e esta leitura cai no caso conservador (tudo a
        // preparar), nunca em "pronta" — o gate falha pro lado que não gasta à toa.
        tagsInferredAt: w?.tags_inferred_at ?? null,
        reviewDigestAt: w?.review_digest_at ?? null,
        reviewSummaryAt: w?.review_summary_at ?? null,
      }),
    )
  }
  return out
}

/** Prontidão de UMA obra — o caminho do servidor, que reclassifica após preparar. */
export async function loadEvalPrepForWork(
  workId: string,
  client?: AdminClient,
): Promise<EvalPrep> {
  const map = await loadEvalPrep([workId], client)
  return map.get(workId)!
}
