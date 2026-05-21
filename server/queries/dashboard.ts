import { createAdminClient } from "@/lib/supabase/admin"
import {
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"

export interface DashboardStats {
  totalWorks: number
  pendingAi: number
  withoutFinalScore: number
  archived: number
  avgFinalScore: number | null
  byPublicationStatus: Record<string, number>
  byPersonalStatus: Record<string, number>
  topWorks: Array<{
    id: string
    title: string
    finalScore: number | null
    calcScore: number | null
    publicationStatus: string
    publicationStatusId: number | null
    personalStatus: string
    personalStatusId: number | null
    aiEvalStatus: string
  }>
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createAdminClient()

  const [worksRes, calcRes, topRes] = await Promise.all([
    supabase
      .from("works")
      .select("id, ai_eval_status, is_archived, publication_status_id, personal_status_id"),
    supabase
      .from("calculated_scores")
      .select("work_id, final_score, calc_score"),
    supabase
      .from("works")
      .select(`
        id, title, publication_status_id, personal_status_id, ai_eval_status, is_archived,
        calculated_scores(final_score, calc_score)
      `)
      .eq("is_archived", false)
      .order("title")
      .limit(200),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (calcRes.error) throw new Error(calcRes.error.message)

  const works = worksRes.data ?? []
  const calcs = calcRes.data ?? []
  const allWorks = topRes.data ?? []

  const active = works.filter((w) => !w.is_archived)
  const totalWorks = active.length
  const pendingAi = active.filter((w) =>
    w.ai_eval_status === "pending" || w.ai_eval_status === "review_pending"
  ).length
  const archived = works.filter((w) => w.is_archived).length

  const calcMap = new Map(calcs.map((c) => [c.work_id, c]))
  const withoutFinalScore = active.filter(
    (w) => (calcMap.get(w.id)?.final_score ?? null) == null
  ).length

  const scoresWithValue = calcs
    .map((c) => c.final_score)
    .filter((s): s is number => s != null)

  const avgFinalScore =
    scoresWithValue.length > 0
      ? scoresWithValue.reduce((a, b) => a + b, 0) / scoresWithValue.length
      : null

  const byPublicationStatus: Record<string, number> = {}
  const byPersonalStatus: Record<string, number> = {}
  for (const w of active) {
    const pubName = getPublicationStatusNameById(w.publication_status_id) ?? "Unknown"
    const persName = getPersonalStatusNameById(w.personal_status_id) ?? "To read"
    byPublicationStatus[pubName] = (byPublicationStatus[pubName] ?? 0) + 1
    byPersonalStatus[persName] = (byPersonalStatus[persName] ?? 0) + 1
  }

  const topWorks = (allWorks as Array<{
    id: string
    title: string
    publication_status_id: number | null
    personal_status_id: number | null
    ai_eval_status: string
    calculated_scores?: { final_score?: number | null; calc_score?: number | null } | null
  }>)
    .map((w) => ({
      id: w.id,
      title: w.title,
      finalScore: w.calculated_scores?.final_score ?? null,
      calcScore: w.calculated_scores?.calc_score ?? null,
      publicationStatus: getPublicationStatusNameById(w.publication_status_id) ?? "Unknown",
      publicationStatusId: w.publication_status_id ?? null,
      personalStatus: getPersonalStatusNameById(w.personal_status_id) ?? "To read",
      personalStatusId: w.personal_status_id ?? null,
      aiEvalStatus: w.ai_eval_status,
    }))
    .filter((w) => w.finalScore != null)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
    .slice(0, 5)

  return {
    totalWorks,
    pendingAi,
    withoutFinalScore,
    archived,
    avgFinalScore,
    byPublicationStatus,
    byPersonalStatus,
    topWorks,
  }
}
