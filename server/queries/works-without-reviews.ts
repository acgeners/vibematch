import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRowsParallel } from "@/lib/supabase/paginate"
import { pickPrimaryCover } from "@/lib/work-derived"
import { isUsefulReviewLength, isUsefulReviewText } from "@/lib/reviews/useful-review"
import { PUBLICATION_STATUSES_BY_ID, PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { classifyWorksWithoutReviews, type NoReviewWork, type NoReviewFilters, type WorkMetaRow } from "@/lib/reviews/no-review-classify"
import { loadEffectiveInterest } from "@/lib/synopsis-interest/effective-interest"
import { workCardCountsRpc } from "@/server/queries/work-card-meta"

export type { NoReviewWork, NoReviewFilters } from "@/lib/reviews/no-review-classify"

export interface NoReviewResult {
  works: NoReviewWork[]
  /** total sem filtro de busca/golden/external (universo "faixa min..máx de reviews úteis"). */
  totalWithoutReviews: number
  /** ids do universo (faixa de reviews) — populado no `countOnly` p/ unir com a aba de tags. */
  ids?: string[]
  /** Reviews úteis por obra (TODAS as obras, já computado no scan) — reaproveitado pela
   *  aba "Tags & Reviews" pra não re-varrer work_reviews no card. */
  usefulCountByWork?: Map<string, number>
}

/**
 * Loader server-only. Read-only. Poucas queries (sem N+1): works ativas, reviews
 * buscadas (text_length+fetched_at), reviews externas manuais (text → regra de utilidade),
 * external ids aceitos, golden ids. A contagem de "reviews úteis" soma buscadas + manuais.
 * NÃO carrega texto de digest. NÃO dispara LLM/summary/digest/avaliação.
 *
 * `countOnly` (caminho do badge/contador de aba): computa só `totalWithoutReviews`
 * (que só depende de status + faixa de reviews úteis, não de busca/golden/external/
 * interesse) e pula a hidratação de capas/fontes/golden/interesse/classificação.
 */
export async function getWorksWithoutReviews(
  filters: NoReviewFilters = {},
  opts: { countOnly?: boolean } = {},
): Promise<NoReviewResult> {
  const sb = createAdminClient()

  // 1) reviews úteis por obra: as duas tabelas (buscadas + manuais) escaneadas em
  // paralelo, cada uma com scan paralelo interno (contagem order-independent).
  // Caminho rápido: RPC agregada (migration 122) — reviews úteis por obra em SQL, 1
  // chamada (work_reviews text_length≥40 + manual trim≥40). Fallback: scan paralelo
  // das duas tabelas (contagem em JS). `lastFetched` (fetched_at) não é mais consumido
  // (card simplificado) → só populado no fallback, por compat. da assinatura do classify.
  const usefulCount = new Map<string, number>()
  const lastFetched = new Map<string, string | null>()
  const rpcCounts = await workCardCountsRpc(sb, null)
  if (rpcCounts) {
    for (const [id, c] of rpcCounts) usefulCount.set(id, c.reviewCount)
  } else {
    const [fetchedRows, manualRows] = await Promise.all([
      fetchAllRowsParallel<{ work_id: string; text_length: number | null; fetched_at: string | null }>(
        () => sb.from("work_reviews").select("work_id", { count: "exact", head: true }),
        (from, to) => sb.from("work_reviews").select("work_id, text_length, fetched_at").range(from, to),
        "work_reviews",
      ),
      // reviews EXTERNAS adicionadas à mão — também alimentam digest/avaliação, então
      // contam pra faixa min/máx. Sem `text_length` na tabela: regra por texto (≥40).
      fetchAllRowsParallel<{ work_id: string; text: string | null }>(
        () => sb.from("work_external_reviews_manual").select("work_id", { count: "exact", head: true }),
        (from, to) => sb.from("work_external_reviews_manual").select("work_id, text").range(from, to),
        "work_external_reviews_manual",
      ),
    ])
    for (const r of fetchedRows) {
      if (isUsefulReviewLength(r.text_length)) usefulCount.set(r.work_id, (usefulCount.get(r.work_id) ?? 0) + 1)
      const prev = lastFetched.get(r.work_id) ?? null
      if (r.fetched_at && (!prev || r.fetched_at > prev)) lastFetched.set(r.work_id, r.fetched_at)
    }
    for (const r of manualRows) {
      if (isUsefulReviewText(r.text ?? "")) usefulCount.set(r.work_id, (usefulCount.get(r.work_id) ?? 0) + 1)
    }
  }

  // 2) works ativas (+ pub/personal filter no SQL). Colunas leves; canonical só presença.
  // Seleciona E FILTRA dado PESSOAL do DONO (personal_status_id, synopsis_quality) → lê do
  // espelho via a view `works_owner`, não da linha compartilhada de `works` (que vai perder
  // essas colunas). Os filtros/`.in()` continuam valendo: a view expõe os mesmos nomes.
  let worksQ = sb
    .from("works_owner")
    .select("id, title, ai_eval_status, canonical_synopsis, publication_status_id, personal_status_id, synopsis_quality, work_covers(url, is_primary, position), calculated_scores(expected_score)")
    .eq("is_archived", false)
  if (filters.pubStatusIds && filters.pubStatusIds.length > 0) worksQ = worksQ.in("publication_status_id", filters.pubStatusIds)
  if (filters.personalStatusIds && filters.personalStatusIds.length > 0) worksQ = worksQ.in("personal_status_id", filters.personalStatusIds)
  const { data: worksData, error: worksErr } = await worksQ
  if (worksErr) throw new Error(`works: ${worksErr.message}`)

  type Row = {
    id: string
    title: string
    ai_eval_status: string | null
    canonical_synopsis: string | null
    publication_status_id: number | null
    personal_status_id: number | null
    synopsis_quality: string | null
    work_covers?: Array<{ url: string; is_primary: boolean | null; position: number | null }> | null
    calculated_scores?: { expected_score?: number | null } | null
  }
  // Faixa [min, máx] de reviews úteis. máx default 0 (= só sem review). Quando máx < min,
  // o limite superior é ignorado (tratado como sem teto) — assim setar só o min dá "≥ min".
  const maxReviews = Math.max(0, Math.floor(filters.maxReviews ?? 0))
  const minReviews = Math.max(0, Math.floor(filters.minReviews ?? 0))
  const inBand = (c: number) => c >= minReviews && (maxReviews < minReviews ? true : c <= maxReviews)
  const activeNoReview = ((worksData ?? []) as Row[]).filter((w) => inBand(usefulCount.get(w.id) ?? 0))
  const totalWithoutReviews = activeNoReview.length
  const ids = activeNoReview.map((w) => w.id)

  // Badge/contador de aba: o total já está pronto e não depende de
  // busca/golden/external/interesse — pula toda a hidratação abaixo. Devolve os
  // ids do universo pra aba "Tags & Reviews" unir com o universo de tags.
  if (opts.countOnly) return { works: [], totalWithoutReviews, ids, usefulCountByWork: usefulCount }

  // 3) external ids aceitos + golden (chunked, leves; chunks em paralelo).
  const acceptedSources = new Map<string, string[]>()
  const goldenIds = new Set<string>()
  const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
  await Promise.all([
    Promise.all(chunk(ids, 200).map(async (c) => {
      const { data, error } = await sb.from("work_external_ids").select("work_id, source, is_rejected").in("work_id", c)
      if (error) throw new Error(`work_external_ids: ${error.message}`)
      for (const r of (data ?? []) as Array<{ work_id: string; source: string; is_rejected: boolean | null }>) {
        if (!r.is_rejected) {
          const list = acceptedSources.get(r.work_id) ?? []
          list.push(r.source)
          acceptedSources.set(r.work_id, list)
        }
      }
    })),
    Promise.all(chunk(ids, 200).map(async (c) => {
      const { data, error } = await sb.from("synopsis_interest_golden").select("work_id").in("work_id", c)
      if (error) throw new Error(`synopsis_interest_golden: ${error.message}`)
      for (const r of (data ?? []) as Array<{ work_id: string }>) goldenIds.add(r.work_id)
    })),
  ])

  // 4) Interesse efetivo (manual ?? previsto) só quando o filtro de interesse está ativo —
  //    a previsão exige paginar synopsis_quality_predictions, evitado no caminho padrão.
  const manualInterest = new Map<string, string | null>()
  for (const w of activeNoReview) manualInterest.set(w.id, w.synopsis_quality ?? null)
  const interestActive = (filters.interest?.length ?? 0) > 0
  const effectiveInterest = interestActive
    ? await loadEffectiveInterest(sb, ids, manualInterest)
    : manualInterest

  const works: WorkMetaRow[] = activeNoReview.map((w) => ({
    id: w.id,
    title: w.title,
    coverUrl: pickPrimaryCover(w.work_covers),
    publicationStatus: w.publication_status_id != null ? (PUBLICATION_STATUSES_BY_ID[w.publication_status_id]?.status ?? "Unknown") : "Unknown",
    publicationStatusId: w.publication_status_id,
    personalStatus: w.personal_status_id != null ? (PERSONAL_STATUSES_BY_ID[w.personal_status_id]?.status ?? "—") : "—",
    personalStatusId: w.personal_status_id,
    aiEvalStatus: w.ai_eval_status,
    canonicalPresent: !!(w.canonical_synopsis && String(w.canonical_synopsis).trim()),
    usefulReviewCount: usefulCount.get(w.id) ?? 0,
    expectedScore: w.calculated_scores?.expected_score != null ? Number(w.calculated_scores.expected_score) : null,
    interest: effectiveInterest.get(w.id) ?? null,
  }))

  const result = classifyWorksWithoutReviews({
    works,
    lastFetchedByWork: lastFetched,
    acceptedSourcesByWork: acceptedSources,
    goldenWorkIds: goldenIds,
    filters,
  })
  return { works: result, totalWithoutReviews, usefulCountByWork: usefulCount }
}
