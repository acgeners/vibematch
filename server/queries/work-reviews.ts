import { createAdminClient } from "@/lib/supabase/admin"
import type { ExternalSourceId } from "@/lib/external/types"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import {
  readManualExternalReviewsForDisplay,
  type ExternalManualReviewDisplayRow,
} from "@/server/queries/external-manual-reviews"

export interface WorkReview {
  id: string
  workId: string
  source: ExternalSourceId
  sourceTitle: string | null
  text: string
  textLength: number | null
  userRating: number | null
  matchScore: number
  fetchedAt: string
  createdAt: string
}

export interface WorkReviewsBySource {
  source: ExternalSourceId
  reviews: WorkReview[]
}

export interface WorkReviewsSnapshot {
  fetchedAt: string | null
  /** Total de reviews EXTERNAS (work_reviews). Reviews manuais contam à parte. */
  total: number
  bySource: WorkReviewsBySource[]
  /** Reviews EXTERNAS adicionadas à mão (work_external_reviews_manual) — exibidas junto das scrapadas. */
  manual: ExternalManualReviewDisplayRow[]
  /** Resumo de consenso das reviews gerado por IA (Haiku). */
  summary: string | null
  summaryAt: string | null
  /** Digest estruturado de reviews (Sonnet) — consenso/divergência/traços/execução/avisos. */
  digest: ReviewDigest | null
  digestAt: string | null
  /** Nº de reviews que entraram no digest. */
  digestN: number | null
  digestVersion: string | null
}

/**
 * Contagem barata (head+exact) de reviews externas scrapadas de uma obra, sem
 * puxar as linhas. Usada no checkpoint da cascata generate_all pra o gate de
 * "sem review". Não inclui reviews manuais (work_external_reviews_manual).
 */
export async function countWorkReviews(workId: string): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("work_reviews")
    .select("work_id", { count: "exact", head: true })
    .eq("work_id", workId)
  if (error) {
    console.warn(`[countWorkReviews] fallback 0: ${error.message}`)
    return 0
  }
  return count ?? 0
}

export async function getWorkReviews(workId: string): Promise<WorkReviewsSnapshot> {
  const supabase = createAdminClient()

  // Resumo, reviews scrapadas e reviews externas manuais em paralelo (DB remoto ~300ms/RT).
  const [summaryRes, reviewsRes, manual] = await Promise.all([
    supabase
      .from("works")
      .select("review_summary, review_summary_at, review_digest, review_digest_at, review_digest_n, review_digest_version")
      .eq("id", workId)
      .maybeSingle(),
    supabase
      .from("work_reviews")
      .select("*")
      .eq("work_id", workId)
      .order("source", { ascending: true })
      .order("match_score", { ascending: false })
      .order("user_rating", { ascending: false, nullsFirst: false }),
    readManualExternalReviewsForDisplay(workId),
  ])

  const summary = (summaryRes.data?.review_summary as string | null) ?? null
  const summaryAt = (summaryRes.data?.review_summary_at as string | null) ?? null
  const digest = (summaryRes.data?.review_digest as ReviewDigest | null) ?? null
  const digestAt = (summaryRes.data?.review_digest_at as string | null) ?? null
  const digestN = (summaryRes.data?.review_digest_n as number | null) ?? null
  const digestVersion = (summaryRes.data?.review_digest_version as string | null) ?? null

  const { data, error } = reviewsRes
  if (error) {
    console.error("[work_reviews] erro lendo reviews:", error)
    return { fetchedAt: null, total: 0, bySource: [], manual, summary, summaryAt, digest, digestAt, digestN, digestVersion }
  }

  const reviews: WorkReview[] = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    return {
      id: r.id as string,
      workId: r.work_id as string,
      source: r.source as ExternalSourceId,
      sourceTitle: (r.source_title as string | null) ?? null,
      text: r.text as string,
      textLength: r.text_length != null ? Number(r.text_length) : null,
      userRating: r.user_rating != null ? Number(r.user_rating) : null,
      matchScore: Number(r.match_score ?? 0),
      fetchedAt: r.fetched_at as string,
      createdAt: r.created_at as string,
    }
  })

  const grouped = new Map<ExternalSourceId, WorkReview[]>()
  for (const r of reviews) {
    const list = grouped.get(r.source)
    if (list) list.push(r)
    else grouped.set(r.source, [r])
  }

  const bySource: WorkReviewsBySource[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, list]) => ({ source, reviews: list }))

  return {
    fetchedAt: reviews[0]?.fetchedAt ?? null,
    total: reviews.length,
    bySource,
    manual,
    summary,
    summaryAt,
    digest,
    digestAt,
    digestN,
    digestVersion,
  }
}
