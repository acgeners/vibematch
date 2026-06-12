import { createAdminClient } from "@/lib/supabase/admin"
import type { ExternalSourceId } from "@/lib/external/types"
import { getManualReviews } from "@/server/queries/manual-reviews"

/** Review escrita à mão pelo usuário, exibida junto das externas (camelCase p/ a UI). */
export interface ManualReviewDisplay {
  id: string
  text: string
  userRating: number | null
  /** Contexto opcional do usuário (não vai pro prompt). */
  note: string | null
}

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
  /** Reviews manuais do usuário (work_manual_reviews) — exibidas junto das externas. */
  manual: ManualReviewDisplay[]
  /** Resumo de consenso das reviews gerado por IA (Haiku). */
  summary: string | null
  summaryAt: string | null
}

export async function getWorkReviews(workId: string): Promise<WorkReviewsSnapshot> {
  const supabase = createAdminClient()

  // Resumo, reviews externas e reviews manuais em paralelo (DB remoto ~300ms/RT).
  const [summaryRes, reviewsRes, manualReviews] = await Promise.all([
    supabase
      .from("works")
      .select("review_summary, review_summary_at")
      .eq("id", workId)
      .maybeSingle(),
    supabase
      .from("work_reviews")
      .select("*")
      .eq("work_id", workId)
      .order("source", { ascending: true })
      .order("match_score", { ascending: false })
      .order("user_rating", { ascending: false, nullsFirst: false }),
    getManualReviews(workId),
  ])

  const summary = (summaryRes.data?.review_summary as string | null) ?? null
  const summaryAt = (summaryRes.data?.review_summary_at as string | null) ?? null
  const manual: ManualReviewDisplay[] = manualReviews.map((m) => ({
    id: m.id,
    text: m.text,
    userRating: m.user_rating,
    note: m.note,
  }))

  const { data, error } = reviewsRes
  if (error) {
    console.error("[work_reviews] erro lendo reviews:", error)
    return { fetchedAt: null, total: 0, bySource: [], manual, summary, summaryAt }
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
  }
}
