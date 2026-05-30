import { createAdminClient } from "@/lib/supabase/admin"
import type { ExternalSourceId } from "@/lib/external/types"

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
  total: number
  bySource: WorkReviewsBySource[]
  /** Resumo de consenso das reviews gerado por IA (Haiku). */
  summary: string | null
  summaryAt: string | null
}

export async function getWorkReviews(workId: string): Promise<WorkReviewsSnapshot> {
  const supabase = createAdminClient()

  const { data: summaryRow } = await supabase
    .from("works")
    .select("review_summary, review_summary_at")
    .eq("id", workId)
    .maybeSingle()
  const summary = (summaryRow?.review_summary as string | null) ?? null
  const summaryAt = (summaryRow?.review_summary_at as string | null) ?? null

  const { data, error } = await supabase
    .from("work_reviews")
    .select("*")
    .eq("work_id", workId)
    .order("source", { ascending: true })
    .order("match_score", { ascending: false })
    .order("user_rating", { ascending: false, nullsFirst: false })
  if (error) {
    console.error("[work_reviews] erro lendo reviews:", error)
    return { fetchedAt: null, total: 0, bySource: [], summary, summaryAt }
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
    summary,
    summaryAt,
  }
}
