import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover } from "@/lib/work-derived"
import { isUsefulReviewLength } from "@/lib/reviews/useful-review"
import { PUBLICATION_STATUSES_BY_ID, PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { classifyWorksWithoutReviews, type NoReviewWork, type NoReviewFilters, type WorkMetaRow } from "@/lib/reviews/no-review-classify"

export type { NoReviewWork, NoReviewFilters } from "@/lib/reviews/no-review-classify"

export interface NoReviewResult {
  works: NoReviewWork[]
  /** total sem filtro de busca/golden/external (universo "≤ maxReviews reviews úteis"). */
  totalWithoutReviews: number
}

/**
 * Loader server-only. Read-only. Poucas queries (sem N+1): works ativas, reviews
 * (text_length+fetched_at), external ids aceitos, golden ids. NÃO carrega texto de
 * review/sinopse/digest. NÃO dispara LLM/summary/digest/avaliação.
 */
export async function getWorksWithoutReviews(filters: NoReviewFilters = {}): Promise<NoReviewResult> {
  const sb = createAdminClient()
  const PAGE = 1000

  // 1) reviews: agrega useful-count + last fetched por obra (colunas leves).
  const usefulCount = new Map<string, number>()
  const lastFetched = new Map<string, string | null>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("work_reviews")
      .select("work_id, text_length, fetched_at")
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`work_reviews: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string; text_length: number | null; fetched_at: string | null }>) {
      if (isUsefulReviewLength(r.text_length)) usefulCount.set(r.work_id, (usefulCount.get(r.work_id) ?? 0) + 1)
      const prev = lastFetched.get(r.work_id) ?? null
      if (r.fetched_at && (!prev || r.fetched_at > prev)) lastFetched.set(r.work_id, r.fetched_at)
    }
    if (!data || data.length < PAGE) break
  }

  // 2) works ativas (+ pub filter no SQL). Colunas leves; canonical só presença.
  let worksQ = sb
    .from("works")
    .select("id, title, ai_eval_status, canonical_synopsis, publication_status_id, personal_status_id, work_covers(url, is_primary, position)")
    .eq("is_archived", false)
  if (filters.pubStatusIds && filters.pubStatusIds.length > 0) worksQ = worksQ.in("publication_status_id", filters.pubStatusIds)
  const { data: worksData, error: worksErr } = await worksQ
  if (worksErr) throw new Error(`works: ${worksErr.message}`)

  type Row = {
    id: string
    title: string
    ai_eval_status: string | null
    canonical_synopsis: string | null
    publication_status_id: number | null
    personal_status_id: number | null
    work_covers?: Array<{ url: string; is_primary: boolean | null; position: number | null }> | null
  }
  const maxReviews = Math.max(0, Math.floor(filters.maxReviews ?? 0))
  const activeNoReview = ((worksData ?? []) as Row[]).filter((w) => (usefulCount.get(w.id) ?? 0) <= maxReviews)
  const totalWithoutReviews = activeNoReview.length
  const ids = activeNoReview.map((w) => w.id)

  // 3) external ids aceitos + golden (chunked, leves).
  const acceptedSources = new Map<string, string[]>()
  const goldenIds = new Set<string>()
  const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
  for (const c of chunk(ids, 200)) {
    const { data, error } = await sb.from("work_external_ids").select("work_id, source, is_rejected").in("work_id", c)
    if (error) throw new Error(`work_external_ids: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string; source: string; is_rejected: boolean | null }>) {
      if (!r.is_rejected) {
        const list = acceptedSources.get(r.work_id) ?? []
        list.push(r.source)
        acceptedSources.set(r.work_id, list)
      }
    }
  }
  for (const c of chunk(ids, 200)) {
    const { data, error } = await sb.from("synopsis_interest_golden").select("work_id").in("work_id", c)
    if (error) throw new Error(`synopsis_interest_golden: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string }>) goldenIds.add(r.work_id)
  }

  const works: WorkMetaRow[] = activeNoReview.map((w) => ({
    id: w.id,
    title: w.title,
    coverUrl: pickPrimaryCover(w.work_covers),
    publicationStatus: w.publication_status_id != null ? (PUBLICATION_STATUSES_BY_ID[w.publication_status_id]?.status ?? "Unknown") : "Unknown",
    personalStatus: w.personal_status_id != null ? (PERSONAL_STATUSES_BY_ID[w.personal_status_id]?.status ?? "—") : "—",
    aiEvalStatus: w.ai_eval_status,
    canonicalPresent: !!(w.canonical_synopsis && String(w.canonical_synopsis).trim()),
    usefulReviewCount: usefulCount.get(w.id) ?? 0,
  }))

  const result = classifyWorksWithoutReviews({
    works,
    lastFetchedByWork: lastFetched,
    acceptedSourcesByWork: acceptedSources,
    goldenWorkIds: goldenIds,
    filters,
  })
  return { works: result, totalWithoutReviews }
}
