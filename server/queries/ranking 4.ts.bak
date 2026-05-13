import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
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
  publicationStatusId: number | null
  publicationStatusShort: string | null
  publicationStatusColor: string | null
  personalStatus: string
  personalStatusId: number | null
  personalStatusSymbol: string | null
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
  genreAll?: string[]
  genreAny?: string[]
  genreExclude?: string[]
  genres?: string[]
  tagSlugsAll?: string[]
  tagSlugsAny?: string[]
  tagSlugsExclude?: string[]
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
  const admin = createAdminClient()

  const [
    { data, error },
    { data: personalStatusRows },
    { data: publicationStatusRows },
  ] = await Promise.all([
    supabase
      .from("works")
      .select(`
        id, title, publication_status, publication_status_id, personal_status, personal_status_id, ai_eval_status,
        total_chapters, manual_score, is_archived,
        cover_url, synopsis, synopsis_quality, year, genres,
        calculated_scores(final_score, calc_score, predicted_score, predicted_is_stub),
        category_scores(criterion_slug, score),
        work_tags(tags(id, name, slug))
      `)
      .eq("is_archived", false)
      .order("title")
      .limit(2000),
    admin
      .from("personal_status")
      .select("id, previous, symbol"),
    admin
      .from("publication_status")
      .select("id, previous, short, color"),
  ])

  if (error) throw new Error(error.message)

  const personalStatusOptions = (personalStatusRows ?? []) as Array<{
    id: number
    previous?: string | null
    symbol: string | null
  }>
  const personalStatusSymbolsById = new Map(
    personalStatusOptions.map((status) => [status.id, status.symbol])
  )
  const personalStatusSymbolsByPrevious = new Map(
    personalStatusOptions
      .filter((status) => status.previous)
      .map((status) => [status.previous!, status.symbol])
  )
  const publicationStatusOptions = (publicationStatusRows ?? []) as Array<{
    id: number
    previous?: string | null
    short: string | null
    color: string | null
  }>
  const publicationStatusDisplayById = new Map(
    publicationStatusOptions.map((status) => [
      status.id,
      { short: status.short, color: status.color },
    ])
  )
  const publicationStatusDisplayByPrevious = new Map(
    publicationStatusOptions
      .filter((status) => status.previous)
      .map((status) => [
        status.previous!,
        { short: status.short, color: status.color },
      ])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: RankingEntry[] = (data ?? []).map((w: any) => {
    const publicationStatusId =
      typeof w.publication_status_id === "number" ? w.publication_status_id : null
    const publicationStatusDisplay = publicationStatusId != null
      ? publicationStatusDisplayById.get(publicationStatusId)
      : publicationStatusDisplayByPrevious.get(w.publication_status)
    const personalStatusId =
      typeof w.personal_status_id === "number" ? w.personal_status_id : null
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
      publicationStatusId,
      publicationStatusShort: publicationStatusDisplay?.short ?? null,
      publicationStatusColor: publicationStatusDisplay?.color ?? null,
      personalStatus: w.personal_status,
      personalStatusId,
      personalStatusSymbol: personalStatusId != null
        ? personalStatusSymbolsById.get(personalStatusId) ?? null
        : personalStatusSymbolsByPrevious.get(w.personal_status) ?? null,
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

  // Hard filter: nunca mostrar obras já finalizadas/dropadas pelo usuário
  entries = entries.filter(
    (e) => e.personalStatus !== "Finalizado" && e.personalStatus !== "Droppado"
  )

  if (filters.publicationStatus?.length) {
    entries = entries.filter((e) => filters.publicationStatus!.includes(e.publicationStatus))
  }
  if (filters.personalStatus?.length) {
    entries = entries.filter((e) => filters.personalStatus!.includes(e.personalStatus))
  }
  if (filters.aiEvalStatus?.length) {
    entries = entries.filter((e) => filters.aiEvalStatus!.includes(e.aiEvalStatus))
  }
  if (filters.genreAll?.length) {
    const wanted = filters.genreAll
    entries = entries.filter((e) => wanted.every((g) => e.genres.includes(g)))
  }
  const genreAny = filters.genreAny ?? filters.genres
  if (genreAny?.length) {
    const wanted = genreAny
    entries = entries.filter((e) => wanted.some((g) => e.genres.includes(g)))
  }
  if (filters.genreExclude?.length) {
    const blocked = filters.genreExclude
    entries = entries.filter((e) => blocked.every((g) => !e.genres.includes(g)))
  }
  if (filters.tagSlugsAll?.length) {
    const wanted = new Set(filters.tagSlugsAll)
    entries = entries.filter((e) => {
      const entryTags = new Set(e.tags.map((t) => t.slug))
      return [...wanted].every((slug) => entryTags.has(slug))
    })
  }
  const tagSlugsAny = filters.tagSlugsAny ?? filters.tagSlugs
  if (tagSlugsAny?.length) {
    const wanted = new Set(tagSlugsAny)
    entries = entries.filter((e) => e.tags.some((t) => wanted.has(t.slug)))
  }
  if (filters.tagSlugsExclude?.length) {
    const blocked = new Set(filters.tagSlugsExclude)
    entries = entries.filter((e) => e.tags.every((t) => !blocked.has(t.slug)))
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
