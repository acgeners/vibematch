import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import { unstable_cache } from "next/cache"

export interface RankingEntry {
  rank: number
  workId: string
  title: string
  finalScore: number | null
  calcScore: number | null
  predictedScore: number | null
  platformAvg: number | null
  totalVotes: number
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
  chaptersRead: number | null
  coverUrl: string | null
  synopsis: string | null
  synopsisQuality: string | null
  year: number | null
  genres: string[]
  scores: Record<string, number>
  tags: Array<{ id: string; name: string; slug: string }>
}

export type RankingSortBy = "final_score" | "calc_score" | "pred_score" | "chapters" | "title" | `crit_${string}`

export interface SortLevel {
  field: RankingSortBy
  dir: "asc" | "desc"
}

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
  maxCalcScore?: number
  minPredictedScore?: number
  maxPredictedScore?: number
  minFinalScore?: number
  maxFinalScore?: number
  minPlatformAvg?: number
  maxPlatformAvg?: number
  minTotalVotes?: number
  maxTotalVotes?: number
  topN?: number
  onlyWithFinalScore?: boolean
  onlyStubPrediction?: boolean
  sortBy?: RankingSortBy
  sortDir?: "asc" | "desc"
  sortLevels?: SortLevel[]
}

const getRankingStatusRows = unstable_cache(
  async () => {
    const admin = createAdminClient()
    const [personal, publication] = await Promise.all([
      admin
        .from("personal_status")
        .select("id, status, previous, symbol"),
      admin
        .from("publication_status")
        .select("id, status, previous, short, color"),
    ])
    return {
      personalStatusRows: personal.data ?? [],
      publicationStatusRows: publication.data ?? [],
    }
  },
  ["ranking-status-rows"],
  { revalidate: 300 }
)

export async function getRanking(
  filters: RankingFilters = {}
): Promise<RankingEntry[]> {
  const supabase = await createClient()
  const { personalStatusRows, publicationStatusRows } = await getRankingStatusRows()
  const personalStatusOptions = (personalStatusRows ?? []) as Array<{
    id: number
    status?: string | null
    previous?: string | null
    symbol: string | null
  }>
  const publicationStatusOptions = (publicationStatusRows ?? []) as Array<{
    id: number
    status?: string | null
    previous?: string | null
    short: string | null
    color: string | null
  }>
  const expandStatusFilter = (
    selected: string[] | undefined,
    options: Array<{ status?: string | null; previous?: string | null }>
  ) => {
    if (!selected?.length) return undefined
    const expanded = new Set(selected)
    for (const value of selected) {
      for (const option of options) {
        if (option.status === value || option.previous === value) {
          if (option.status) expanded.add(option.status)
          if (option.previous) expanded.add(option.previous)
        }
      }
    }
    return [...expanded]
  }
  const publicationStatusFilter = expandStatusFilter(filters.publicationStatus, publicationStatusOptions)
  const personalStatusFilter = expandStatusFilter(filters.personalStatus, personalStatusOptions)

  let worksQuery = supabase
    .from("works")
    .select(`
      id, title, publication_status, publication_status_id, personal_status, personal_status_id, ai_eval_status,
      total_chapters, chapters_read, manual_score, is_archived,
      cover_url, synopsis, synopsis_quality, year, genres,
      calculated_scores(final_score, calc_score, predicted_score, predicted_is_stub, platform_avg, total_votes),
      category_scores(criterion_slug, score),
      work_tags(tags(id, name, slug))
    `)
    .eq("is_archived", false)

  if (publicationStatusFilter?.length) {
    worksQuery = worksQuery.in("publication_status", publicationStatusFilter)
  }
  if (personalStatusFilter?.length) {
    worksQuery = worksQuery.in("personal_status", personalStatusFilter)
  }
  if (filters.aiEvalStatus?.length) {
    worksQuery = worksQuery.in("ai_eval_status", filters.aiEvalStatus)
  }
  if (filters.synopsisQualities?.length) {
    worksQuery = worksQuery.in("synopsis_quality", filters.synopsisQualities)
  }
  if (filters.minTotalChapters != null) {
    worksQuery = worksQuery.gte("total_chapters", filters.minTotalChapters)
  }
  if (filters.maxTotalChapters != null) {
    worksQuery = worksQuery.lte("total_chapters", filters.maxTotalChapters)
  }

  const { data, error } = await worksQuery.order("title").limit(2000)

  if (error) throw new Error(error.message)

  const personalStatusSymbolsById = new Map(
    personalStatusOptions.map((status) => [status.id, status.symbol])
  )
  const personalStatusSymbolsByPrevious = new Map(
    personalStatusOptions
      .filter((status) => status.previous)
      .map((status) => [status.previous!, status.symbol])
  )
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
      platformAvg: w.calculated_scores?.platform_avg ?? null,
      totalVotes: w.calculated_scores?.total_votes ?? 0,
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
      chaptersRead: w.chapters_read ?? null,
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
    (e) => !["Finalizado", "Droppado", "Completed", "Dropped"].includes(e.personalStatus)
  )

  if (filters.publicationStatus?.length) {
    entries = entries.filter((e) => publicationStatusFilter?.includes(e.publicationStatus))
  }
  if (filters.personalStatus?.length) {
    entries = entries.filter((e) => personalStatusFilter?.includes(e.personalStatus))
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
  if (filters.maxCalcScore != null) {
    const max = filters.maxCalcScore
    entries = entries.filter((e) => e.calcScore != null && e.calcScore <= max)
  }
  if (filters.minPredictedScore != null) {
    const min = filters.minPredictedScore
    entries = entries.filter((e) => e.predictedScore != null && e.predictedScore >= min)
  }
  if (filters.maxPredictedScore != null) {
    const max = filters.maxPredictedScore
    entries = entries.filter((e) => e.predictedScore != null && e.predictedScore <= max)
  }
  if (filters.minFinalScore != null) {
    const min = filters.minFinalScore
    entries = entries.filter((e) => e.finalScore != null && e.finalScore >= min)
  }
  if (filters.maxFinalScore != null) {
    const max = filters.maxFinalScore
    entries = entries.filter((e) => e.finalScore != null && e.finalScore <= max)
  }
  if (filters.minPlatformAvg != null) {
    const min = filters.minPlatformAvg
    entries = entries.filter((e) => e.platformAvg != null && e.platformAvg >= min)
  }
  if (filters.maxPlatformAvg != null) {
    const max = filters.maxPlatformAvg
    entries = entries.filter((e) => e.platformAvg != null && e.platformAvg <= max)
  }
  if (filters.minTotalVotes != null) {
    const min = filters.minTotalVotes
    entries = entries.filter((e) => e.totalVotes >= min)
  }
  if (filters.maxTotalVotes != null) {
    const max = filters.maxTotalVotes
    entries = entries.filter((e) => e.totalVotes <= max)
  }
  if (filters.onlyWithFinalScore) {
    entries = entries.filter((e) => e.finalScore != null)
  }
  if (filters.onlyStubPrediction) {
    entries = entries.filter((e) => e.predictedIsStub)
  }

  // Ordenação
  const levels: SortLevel[] = filters.sortLevels?.length
    ? filters.sortLevels
    : [{ field: filters.sortBy ?? "final_score", dir: filters.sortDir ?? "desc" }]

  function compareByField(a: RankingEntry, b: RankingEntry, field: string, dir: "asc" | "desc"): number {
    const m = dir === "asc" ? 1 : -1
    if (field === "title") return m * a.title.localeCompare(b.title)
    if (field === "final_score") {
      const av = a.finalScore ?? a.calcScore ?? -Infinity
      const bv = b.finalScore ?? b.calcScore ?? -Infinity
      return m * (av - bv)
    }
    if (field === "calc_score") return m * ((a.calcScore ?? -Infinity) - (b.calcScore ?? -Infinity))
    if (field === "pred_score") return m * ((a.predictedScore ?? -Infinity) - (b.predictedScore ?? -Infinity))
    if (field === "chapters") return m * ((a.totalChapters ?? -Infinity) - (b.totalChapters ?? -Infinity))
    if (field.startsWith("crit_")) {
      const slug = field.slice(5)
      return m * ((a.scores[slug] ?? -Infinity) - (b.scores[slug] ?? -Infinity))
    }
    return 0
  }

  entries.sort((a, b) => {
    for (const level of levels) {
      const cmp = compareByField(a, b, level.field, level.dir)
      if (cmp !== 0) return cmp
    }
    return a.title.localeCompare(b.title)
  })

  // Top N (depois da ordenação) — registra rank antes de cortar
  entries.forEach((e, i) => { e.rank = i + 1 })
  if (filters.topN != null && filters.topN > 0) {
    entries = entries.slice(0, filters.topN)
  }

  return entries
}
