import { createClient } from "@/lib/supabase/server"
import { CRITERION_SLUGS } from "@/types/domain"

export interface RankingEntry {
  rank: number
  workId: string
  title: string
  finalScore: number | null
  calcScore: number | null
  predictedScore: number | null
  predictedIsStub: boolean
  manualScore: number | null
  publicationStatus: string
  personalStatus: string
  aiEvalStatus: string
  totalChapters: number | null
  coverUrl: string | null
  synopsis: string | null
  synopsisQuality: string | null
  year: number | null
  genres: string[]
  scores: Record<string, number>
  tags: Array<{ id: string; name: string; slug: string }>
}

export type RankingSortBy = "final_score" | "calc_score" | "title"

export interface RankingFilters {
  criterionMin?: Partial<Record<string, number>>
  criterionMax?: Partial<Record<string, number>>
  publicationStatus?: string[]
  personalStatus?: string[]
  aiEvalStatus?: string[]
  genres?: string[]
  tagSlugs?: string[]
  synopsisQualities?: string[]
  minTotalChapters?: number
  maxTotalChapters?: number
  minCalcScore?: number
  minPredictedScore?: number
  minFinalScore?: number
  topN?: number
  onlyWithFinalScore?: boolean
  onlyStubPrediction?: boolean
  sortBy?: RankingSortBy
  sortDir?: "asc" | "desc"
}

export async function getRanking(
  filters: RankingFilters = {}
): Promise<RankingEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, publication_status, personal_status, ai_eval_status,
      total_chapters, manual_score, is_archived,
      cover_url, synopsis, synopsis_quality, year, genres,
      calculated_scores(final_score, calc_score, predicted_score, predicted_is_stub),
      category_scores(criterion_slug, score),
      work_tags(tags(id, name, slug))
    `)
    .eq("is_archived", false)
    .order("title")
    .limit(2000)

  if (error) throw new Error(error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: RankingEntry[] = (data ?? []).map((w: any) => {
    const scores: Record<string, number> = {}
    for (const cs of w.category_scores ?? []) {
      scores[cs.criterion_slug] = cs.score
    }
    return {
      rank: 0,
      workId: w.id,
      title: w.title,
      finalScore: w.calculated_scores?.final_score ?? null,
      calcScore: w.calculated_scores?.calc_score ?? null,
      predictedScore: w.calculated_scores?.predicted_score ?? null,
      predictedIsStub: w.calculated_scores?.predicted_is_stub ?? true,
      manualScore: w.manual_score,
      publicationStatus: w.publication_status,
      personalStatus: w.personal_status,
      aiEvalStatus: w.ai_eval_status,
      totalChapters: w.total_chapters,
      coverUrl: w.cover_url ?? null,
      synopsis: w.synopsis ?? null,
      synopsisQuality: w.synopsis_quality ?? null,
      year: w.year ?? null,
      genres: Array.isArray(w.genres) ? w.genres : [],
      scores,
      tags: (w.work_tags ?? []).map((wt: { tags: unknown }) => wt.tags).filter(Boolean),
    }
  })

  // Filtros por critério (min e max para todos os 9)
  for (const slug of CRITERION_SLUGS) {
    const min = filters.criterionMin?.[slug]
    const max = filters.criterionMax?.[slug]
    if (min != null) entries = entries.filter((e) => (e.scores[slug] ?? 0) >= min)
    if (max != null) entries = entries.filter((e) => (e.scores[slug] ?? 10) <= max)
  }

  // Hard filter: never show Completed ('C') or Dropped ('D')
  entries = entries.filter((e) => e.publicationStatus !== "Completed" && e.publicationStatus !== "Cancelled")

  if (filters.publicationStatus?.length) {
    entries = entries.filter((e) => filters.publicationStatus!.includes(e.publicationStatus))
  }
  if (filters.personalStatus?.length) {
    entries = entries.filter((e) => filters.personalStatus!.includes(e.personalStatus))
  }
  if (filters.aiEvalStatus?.length) {
    entries = entries.filter((e) => filters.aiEvalStatus!.includes(e.aiEvalStatus))
  }
  if (filters.genres?.length) {
    const wanted = filters.genres
    entries = entries.filter((e) => wanted.some((g) => e.genres.includes(g)))
  }
  if (filters.tagSlugs?.length) {
    const wanted = new Set(filters.tagSlugs)
    entries = entries.filter((e) => e.tags.some((t) => wanted.has(t.slug)))
  }
  if (filters.synopsisQualities?.length) {
    const wanted = new Set(filters.synopsisQualities)
    entries = entries.filter((e) => e.synopsisQuality != null && wanted.has(e.synopsisQuality))
  }
  if (filters.minTotalChapters != null) {
    const min = filters.minTotalChapters
    entries = entries.filter((e) => e.totalChapters != null && e.totalChapters >= min)
  }
  if (filters.maxTotalChapters != null) {
    const max = filters.maxTotalChapters
    entries = entries.filter((e) => e.totalChapters != null && e.totalChapters <= max)
  }

  // Filtros de notas mínimas (vindos das preferências de ranking)
  if (filters.minCalcScore != null) {
    const min = filters.minCalcScore
    entries = entries.filter((e) => e.calcScore != null && e.calcScore >= min)
  }
  if (filters.minPredictedScore != null) {
    const min = filters.minPredictedScore
    entries = entries.filter((e) => e.predictedScore != null && e.predictedScore >= min)
  }
  if (filters.minFinalScore != null) {
    const min = filters.minFinalScore
    entries = entries.filter((e) => e.finalScore != null && e.finalScore >= min)
  }
  if (filters.onlyWithFinalScore) {
    entries = entries.filter((e) => e.finalScore != null)
  }
  if (filters.onlyStubPrediction) {
    entries = entries.filter((e) => e.predictedIsStub)
  }

  // Ordenação
  const sortBy = filters.sortBy ?? "final_score"
  const asc = filters.sortDir === "asc"

  entries.sort((a, b) => {
    if (sortBy === "title") {
      const cmp = a.title.localeCompare(b.title)
      return asc ? cmp : -cmp
    }
    if (sortBy === "calc_score") {
      const aScore = a.calcScore ?? -1
      const bScore = b.calcScore ?? -1
      return asc ? aScore - bScore : bScore - aScore
    }
    // default: final_score
    const aScore = a.finalScore ?? a.calcScore ?? -1
    const bScore = b.finalScore ?? b.calcScore ?? -1
    if (bScore !== aScore) return asc ? aScore - bScore : bScore - aScore
    return a.title.localeCompare(b.title)
  })

  // Top N (depois da ordenação) — registra rank antes de cortar
  entries.forEach((e, i) => { e.rank = i + 1 })
  if (filters.topN != null && filters.topN > 0) {
    entries = entries.slice(0, filters.topN)
  }

  return entries
}
