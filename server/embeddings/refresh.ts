import "server-only"

// Geração de embeddings (custa API). NÃO é `"use server"`: `refreshEmbeddingForWork`
// roda dentro da cascata de criação (sem sessão), então gate aqui a mataria; e como
// endpoint público era gasto de API grátis pra qualquer um. A fachada
// `server/actions/embeddings.ts` expõe só `refreshEmbeddings` (o botão do painel).

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import type { CategoryScoreMap, CriterionSlug } from "@/types/domain"
import {
  buildEmbeddingInput,
  type EmbeddingInputData,
} from "@/lib/ml/embedding-input"
import {
  embedTexts,
  EMBEDDING_MODEL,
  MAX_BATCH_SIZE,
} from "@/lib/ml/embeddings"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { buildReviewContext } from "@/lib/tags/infer-from-text"
import { ensureAdmin } from "@/server/queries/current-user"
import { fetchAllRows } from "@/lib/supabase/paginate"

/**
 * Tamanho da PÁGINA das duas leituras, não um teto de resultado.
 *
 * 🔴 Era `QUERY_LIMIT = 2000` aplicado numa requisição só, e isso causava dois
 * problemas de naturezas opostas — ver `loadEmbeddingCandidates`.
 */
const PAGE_SIZE = 200

export interface RefreshEmbeddingsResult {
  totalWorks: number
  /** Quantas obras já tinham embedding atualizado (hash bate). */
  skipped: number
  /** Quantas obras embedaram nesta execução. */
  refreshed: number
  /** Tokens consumidos no total — multiplique por $0.02/M pra estimar custo. */
  tokensUsed: number
  /** Estimativa de custo em USD (text-embedding-3-small: $0.02/M tokens). */
  estimatedCostUsd: number
  /** Quantas obras falharam (erro persistido em logs). */
  failed: number
}

interface WorkForEmbedding {
  workId: string
  data: EmbeddingInputData
}

interface ExistingHashRow {
  work_id: string
  input_hash: string
  model_name: string
}

function buildWorkFromRow(row: Record<string, unknown>): WorkForEmbedding {
  const categoryScores: CategoryScoreMap = {}
  for (const cs of (row.category_scores as Array<{ criterion_slug: string; score: number }> | null) ??
    []) {
    categoryScores[cs.criterion_slug as CriterionSlug] = Number(cs.score)
  }

  const tags = ((row.work_tags as
    | Array<{ tags?: { name?: string; tag_group_id?: string | null } | null }>
    | null) ?? [])
    .map((wt) => wt?.tags)
    .filter(
      (t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name),
    )
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null : null,
    }))

  const synopsis = pickPrimarySynopsis(
    (row.work_synopses as
      | Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }>
      | undefined)?.map((s) => ({
      text: s.text ?? null,
      is_primary: s.is_primary ?? null,
      position: s.position ?? null,
    })),
  )

  const reviewContext =
    buildReviewContext(row.review_summary, row.review_digest) ?? null

  return {
    workId: row.id as string,
    data: {
      title: row.title as string,
      synopsis,
      tags,
      categoryScores,
      reviewContext,
    },
  }
}

type Candidate = WorkForEmbedding & { hash: string; text: string }

const EXISTING_COLS = "work_id, input_hash, model_name"

/**
 * Envolve uma leitura com o NOME do passo — e traduz a falha de transporte.
 *
 * 🔴 `fetchAllRows` rotula só o erro que o PostgREST DEVOLVE (`{ error }`). Um
 * corte de conexão não é isso: o `fetch` do Node LANÇA, e a exceção sobe crua até
 * o toast, que exibia exatamente `TypeError: terminated` — uma mensagem que não
 * diz nem o que estava sendo lido, nem que a causa é transporte e não código. Foi
 * o que a Ana viu no painel de embeddings.
 */
async function comContexto<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // `terminated` é o erro do undici pra "o corpo da resposta morreu no meio".
    const dica = /terminated|socket|ECONNRESET|fetch failed|aborted/i.test(msg)
      ? " (a resposta foi cortada no meio — timeout do PostgREST ou queda de conexão, não erro de código; rode de novo)"
      : ""
    throw new Error(`${rotulo} falhou: ${msg}${dica}`)
  }
}

/** O caminho de UMA obra não pagina — mas tem que falhar igual ao paginado. */
async function fetchOne<T>(
  query: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const { data, error } = await query()
  if (error) throw new Error(`${label}: ${error.message}`)
  return data ?? []
}

/**
 * Carrega o catálogo e os hashes já persistidos, em PÁGINAS.
 *
 * 🔴 **Duas leituras, dois problemas opostos, os dois silenciosos** (2026-08-14):
 *
 * 1. **`works` vinha numa requisição só** — `.limit(2000)` sobre o catálogo com
 *    quatro joins embutidos e as colunas mais gordas da tabela (`review_digest`,
 *    `review_summary`). Medido: **8,6 MB crus em 978 linhas**. É a maior resposta
 *    única do app, e ela é o suspeito do `TypeError: terminated` que o painel de
 *    embeddings mostrou: undici lança isso quando o CORPO da resposta morre no
 *    meio — o que acontece se o PostgREST estourar o `statement_timeout` DEPOIS de
 *    já ter mandado os headers. ⚠️ Isso é a hipótese mais provável, não uma causa
 *    confirmada: a falha não foi reproduzida, e um corte de rede dá a mesma
 *    mensagem. A paginação vale de qualquer forma — cada página fica bem abaixo de
 *    qualquer timeout, e o erro passa a dizer QUAL página caiu.
 *
 * 2. **`work_embeddings` não paginava NEM tinha limite** ⇒ o corte default de
 *    1000 linhas do PostgREST, o erro que este projeto mais paga. Medido no mesmo
 *    dia: **985 linhas — 15 do estouro.** A partir de 1001, as linhas cortadas
 *    sumiriam do mapa de hashes, as obras correspondentes passariam por "nunca
 *    embedadas" e seriam **re-embedadas e re-pagas a cada execução**, com o painel
 *    dizendo "N atualizados" e nada acusando. Erro que produz resultado.
 *
 * ⚠️ Página de 200 e não 1000: o peso aqui é BYTE, não linha — 1000 linhas desta
 * projeção são os mesmos 8,6 MB de antes, só que com `.range()` em volta.
 */
async function loadEmbeddingCandidates(workId?: string): Promise<{
  totalWorks: number
  skipped: number
  candidates: Candidate[]
}> {
  const supabase = createAdminClient()

  const WORK_COLS = `id, title, review_digest, review_summary,
       category_scores(criterion_slug, score),
       work_tags(tags(name, tag_group_id)),
       work_synopses(text, is_primary, position)`

  const [workRows, existingRows] = await Promise.all([
    workId
      ? fetchOne(() => supabase.from("works").select(WORK_COLS).eq("id", workId), "works")
      : comContexto("Leitura do catálogo", () =>
          fetchAllRows<Record<string, unknown>>(
            (from, to) =>
              supabase
                .from("works")
                .select(WORK_COLS)
                .eq("is_archived", false)
                .range(from, to),
            "loadEmbeddingCandidates(works)",
            PAGE_SIZE,
          ),
        ),
    workId
      ? fetchOne(
          () => supabase.from("work_embeddings").select(EXISTING_COLS).eq("work_id", workId),
          "work_embeddings",
        )
      : comContexto("Leitura dos embeddings já salvos", () =>
          fetchAllRows<ExistingHashRow>(
            (from, to) => supabase.from("work_embeddings").select(EXISTING_COLS).range(from, to),
            "loadEmbeddingCandidates(work_embeddings)",
            PAGE_SIZE,
          ),
        ),
  ])

  const existingByWork = new Map<string, ExistingHashRow>(
    (existingRows as ExistingHashRow[]).map((r) => [r.work_id, r]),
  )

  const works = (workRows as Array<Record<string, unknown>>).map(buildWorkFromRow)
  const totalWorks = works.length

  const candidates: Candidate[] = []
  let skipped = 0

  for (const w of works) {
    const { text, hash } = buildEmbeddingInput(w.data)
    const existing = existingByWork.get(w.workId)
    const upToDate = existing?.input_hash === hash && existing?.model_name === EMBEDDING_MODEL
    if (upToDate) {
      skipped += 1
      continue
    }
    candidates.push({ ...w, hash, text })
  }

  return { totalWorks, skipped, candidates }
}

export interface EmbeddingsPendingCount {
  totalWorks: number
  pending: number
}

/**
 * Conta obras com embedding desatualizado (sem chamar a OpenAI). Usa o mesmo
 * critério do refresh: hash atual difere do persistido, modelo mudou, ou não
 * há linha em work_embeddings.
 */
export async function countStaleEmbeddings(): Promise<EmbeddingsPendingCount> {
  const { totalWorks, candidates } = await loadEmbeddingCandidates()
  return { totalWorks, pending: candidates.length }
}

/**
 * Identifica obras com embedding desatualizado e re-embeda apenas elas.
 *
 * Critério "desatualizado": `input_hash` da obra atual difere do que está
 * persistido em `work_embeddings`, OU não existe registro pra essa obra,
 * OU `model_name` mudou.
 */
export async function refreshEmbeddings(): Promise<RefreshEmbeddingsResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  const supabase = createAdminClient()
  const { totalWorks, skipped, candidates } = await loadEmbeddingCandidates()

  if (candidates.length === 0) {
    return {
      totalWorks,
      skipped,
      refreshed: 0,
      tokensUsed: 0,
      estimatedCostUsd: 0,
      failed: 0,
    }
  }

  const { refreshed, failed, totalTokens } = await embedAndUpsert(supabase, candidates)

  return {
    totalWorks,
    skipped,
    refreshed,
    tokensUsed: totalTokens,
    estimatedCostUsd: (totalTokens / 1_000_000) * 0.02,
    failed,
  }
}

/**
 * Núcleo compartilhado: embeda os candidatos em chunks (alinhados ao batch da
 * API pra erros granulares) e faz upsert em work_embeddings (onConflict work_id).
 * Usado por refreshEmbeddings (catálogo) e refreshEmbeddingForWork (1 obra).
 */
async function embedAndUpsert(
  supabase: ReturnType<typeof createAdminClient>,
  candidates: Candidate[],
): Promise<{ refreshed: number; failed: number; totalTokens: number }> {
  let refreshed = 0
  let failed = 0
  let totalTokens = 0

  for (let i = 0; i < candidates.length; i += MAX_BATCH_SIZE) {
    const chunk = candidates.slice(i, i + MAX_BATCH_SIZE)
    try {
      const { vectors, tokensUsed } = await embedTexts(chunk.map((c) => c.text))
      totalTokens += tokensUsed

      const rows = chunk.map((c, idx) => ({
        work_id: c.workId,
        embedding: JSON.stringify(vectors[idx]),
        model_name: EMBEDDING_MODEL,
        input_hash: c.hash,
        updated_at: new Date().toISOString(),
      }))

      const { error: upsertErr } = await supabase
        .from("work_embeddings")
        .upsert(rows, { onConflict: "work_id" })

      if (upsertErr) {
        console.error(`[embeddings] upsert falhou no chunk ${i}: ${upsertErr.message}`)
        failed += chunk.length
      } else {
        refreshed += chunk.length
      }
    } catch (err) {
      console.error(
        `[embeddings] chunk ${i} (${chunk.length} obras) falhou:`,
        err instanceof Error ? err.message : err,
      )
      failed += chunk.length
    }
  }

  return { refreshed, failed, totalTokens }
}

export interface RefreshEmbeddingForWorkResult {
  /** true se re-embedou; false se o input_hash não mudou (no-op). */
  refreshed: boolean
  tokensUsed: number
  estimatedCostUsd: number
  failed: boolean
}

/**
 * Escopa o refresh de embedding a UMA obra (passo final da cascata generate_all).
 * Reusa loadEmbeddingCandidates(workId): se o input_hash não mudou, é no-op barato
 * (o embedding depende de sinopse+tags+scores+digest, então roda por último).
 */
export async function refreshEmbeddingForWork(
  workId: string,
): Promise<RefreshEmbeddingForWorkResult> {
  const supabase = createAdminClient()
  const { candidates } = await loadEmbeddingCandidates(workId)
  if (candidates.length === 0) {
    return { refreshed: false, tokensUsed: 0, estimatedCostUsd: 0, failed: false }
  }
  const { refreshed, failed, totalTokens } = await embedAndUpsert(supabase, candidates)
  return {
    refreshed: refreshed > 0,
    tokensUsed: totalTokens,
    estimatedCostUsd: (totalTokens / 1_000_000) * 0.02,
    failed: failed > 0,
  }
}
