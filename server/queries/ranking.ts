import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import { unstable_cache } from "next/cache"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { pickPrimarySynopsis, pickPrimaryCover } from "@/lib/work-derived"

export interface RankingDifferentiator {
  slug: string
  diff: number
}

export interface RankingEntry {
  rank: number
  percentile: number
  differentiators: RankingDifferentiator[]
  workId: string
  title: string
  finalScore: number | null
  calcScore: number | null
  predictedScore: number | null
  /** L1 novo (single Ridge + decomposição). Substitui finalScore na UI nova. */
  expectedScore: number | null
  /** Stage 1 da decomposição — contribuição das features de perfil/tipo. */
  expectedBaseline: number | null
  /** Stage 2 da decomposição — contribuição das 8 quality scores. */
  expectedQualityAdj: number | null
  expectedIsStub: boolean
  platformAvg: number | null
  totalVotes: number
  predictedIsStub: boolean
  personalFit: number | null
  /** Percentil 0–100 dentro da biblioteca. NULL quando personalFit é NULL ou pré-migration 071. */
  personalFitPercentile: number | null
  finalScoreConfidence: number | null
  knnScore: number | null
  alignmentScore: number | null
  alignmentJustification: string | null
  alignmentAt: string | null
  /** Payload enriquecido (sub-fase 2.3.A). NULL pra runs antigas (prompt v1). */
  alignmentPayload: {
    confidence?: number
    risks?: string[]
    similar_loved?: string[]
    similar_avoided?: string[]
    review_quotes?: string[]
    mood_fit?: number
  } | null
  manualScore: number | null
  isFavorite: boolean
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
  observations: string | null
  year: number | null
  updatedAt: string | null
  lastReadAt: string | null
  genres: string[]
  scores: Record<string, number>
  tags: Array<{ id: string; name: string; slug: string; tag_group_id: string | null }>
}

export type RankingSortBy =
  | "final_score"
  | "calc_score"
  | "pred_score"
  | "predicted_score"
  | "expected_score"
  | "platform_avg"
  | "total_votes"
  | "chapters"
  | "chapters_total"
  | "chapters_read"
  | "title"
  | "year"
  | "synopsis_q"
  | "updated_at"
  | "publication_status"
  | "personal_status"
  | "ai_eval_status"
  | "last_read_at"
  | "personal_fit"
  | "knn_score"
  | "alignment_score"
  | `crit_${string}`

export interface SortLevel {
  field: RankingSortBy
  dir: "asc" | "desc"
}

export interface RankingFilters {
  search?: string
  includeArchived?: boolean
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
  onlyFavorites?: boolean
  /** Quando true, não aplica o hard filter que esconde obras Completed/Dropped.
   *  Default false (mantém semântica de "ranking de o que ler"). Páginas tipo
   *  /titles e /favorites devem passar true. */
  includeFinishedDropped?: boolean
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
        .select("id, status, symbol"),
      admin
        .from("publication_status")
        .select("id, status, short, color"),
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
  const supabase = createAdminClient()
  const { personalStatusRows, publicationStatusRows } = await getRankingStatusRows()
  const personalStatusOptions = (personalStatusRows ?? []) as Array<{
    id: number
    status?: string | null
    symbol: string | null
  }>
  const publicationStatusOptions = (publicationStatusRows ?? []) as Array<{
    id: number
    status?: string | null
    short: string | null
    color: string | null
  }>

  const resolveStatusIds = (
    selected: string[] | undefined,
    nameToId: (name: string) => number | null
  ) => {
    if (!selected?.length) return undefined
    const ids = selected.map(nameToId).filter((id): id is number => id != null)
    return ids.length > 0 ? ids : []
  }
  const publicationStatusIdFilter = resolveStatusIds(filters.publicationStatus, getPublicationStatusIdByName)
  const personalStatusIdFilter = resolveStatusIds(filters.personalStatus, getPersonalStatusIdByName)

  // Pre-resolve genre/tag id filters in parallel via pivot tables. Pushing this
  // into Supabase narrows the heavy joined fetch below instead of loading 2000
  // rows just to drop most in memory.
  const genreAnyNames = filters.genreAny ?? filters.genres
  const tagAnySlugs = filters.tagSlugsAny ?? filters.tagSlugs

  const [
    genreAllIds,
    genreAnyIds,
    genreExcludeIds,
    tagAllIds,
    tagAnyIds,
    tagExcludeIds,
  ] = await Promise.all([
    filters.genreAll?.length
      ? supabase
          .from("work_genres")
          .select("work_id, genres!inner(name)")
          .in("genres.name", filters.genreAll)
          .then(({ data }) => {
            const countByWork: Record<string, number> = {}
            for (const r of data ?? []) {
              countByWork[r.work_id] = (countByWork[r.work_id] ?? 0) + 1
            }
            return Object.entries(countByWork)
              .filter(([, c]) => c >= filters.genreAll!.length)
              .map(([id]) => id)
          })
      : Promise.resolve(null),
    genreAnyNames?.length
      ? supabase
          .from("work_genres")
          .select("work_id, genres!inner(name)")
          .in("genres.name", genreAnyNames)
          .then(({ data }) => [...new Set((data ?? []).map((r) => r.work_id))])
      : Promise.resolve(null),
    filters.genreExclude?.length
      ? supabase
          .from("work_genres")
          .select("work_id, genres!inner(name)")
          .in("genres.name", filters.genreExclude)
          .then(({ data }) => [...new Set((data ?? []).map((r) => r.work_id))])
      : Promise.resolve(null),
    filters.tagSlugsAll?.length
      ? supabase
          .from("work_tags")
          .select("work_id, tags!inner(slug)")
          .in("tags.slug", filters.tagSlugsAll)
          .then(({ data }) => {
            const countByWork: Record<string, number> = {}
            for (const r of data ?? []) {
              countByWork[r.work_id] = (countByWork[r.work_id] ?? 0) + 1
            }
            return Object.entries(countByWork)
              .filter(([, c]) => c >= filters.tagSlugsAll!.length)
              .map(([id]) => id)
          })
      : Promise.resolve(null),
    tagAnySlugs?.length
      ? supabase
          .from("work_tags")
          .select("work_id, tags!inner(slug)")
          .in("tags.slug", tagAnySlugs)
          .then(({ data }) => [...new Set((data ?? []).map((r) => r.work_id))])
      : Promise.resolve(null),
    filters.tagSlugsExclude?.length
      ? supabase
          .from("work_tags")
          .select("work_id, tags!inner(slug)")
          .in("tags.slug", filters.tagSlugsExclude)
          .then(({ data }) => [...new Set((data ?? []).map((r) => r.work_id))])
      : Promise.resolve(null),
    ])

  // Combine include sets via intersection; expand exclude set.
  const includeSets: string[][] = []
  if (genreAllIds) includeSets.push(genreAllIds)
  if (genreAnyIds) includeSets.push(genreAnyIds)
  if (tagAllIds) includeSets.push(tagAllIds)
  if (tagAnyIds) includeSets.push(tagAnyIds)
  const excludeIds = new Set<string>([
    ...(genreExcludeIds ?? []),
    ...(tagExcludeIds ?? []),
  ])

  let allowedIds: string[] | null = null
  if (includeSets.length > 0) {
    allowedIds = includeSets.reduce<string[]>((acc, set, i) => {
      if (i === 0) return [...set]
      const setLookup = new Set(set)
      return acc.filter((id) => setLookup.has(id))
    }, [])
    if (excludeIds.size) allowedIds = allowedIds.filter((id) => !excludeIds.has(id))
    if (allowedIds.length === 0) return []
  }

  let worksQuery = supabase
    .from("works")
    .select(`
      id, title, publication_status_id, personal_status_id, ai_eval_status,
      total_chapters, chapters_read, manual_score, is_archived, is_favorite,
      synopsis_quality, observations, year, updated_at, last_read_at,
      calculated_scores(final_score, calc_score, predicted_score, predicted_is_stub, expected_score, expected_baseline, expected_quality_adj, expected_is_stub, platform_avg, total_votes, personal_fit, personal_fit_percentile, final_score_confidence, knn_score, alignment_score, alignment_justification, alignment_payload, alignment_at),
      category_scores(criterion_slug, score),
      work_tags(tags(id, name, slug, tag_group_id)),
      work_genres(genres(name)),
      work_covers(url, is_primary, position),
      work_synopses(text, is_primary, position)
    `)

  if (!filters.includeArchived) {
    worksQuery = worksQuery.eq("is_archived", false)
  }

  if (filters.search?.trim()) {
    // Tokeniza separando por espaços e pontuação: o padrão `%a%b%c%` permite que
    // o ILIKE atravesse vírgulas/`?`/etc. presentes no título mas ausentes na
    // busca. Vírgulas também são separadores do filtro `or` do PostgREST, então
    // não podem aparecer no valor.
    const tokens = filters.search
      .replace(/[%_]/g, "")
      .split(/[\s,;:!?·•–—()[\]{}'"`]+/)
      .filter(Boolean)
    if (tokens.length) {
      const pattern = `%${tokens.join("%")}%`
      worksQuery = worksQuery.or(
        `title.ilike.${pattern},original_title.ilike.${pattern}`
      )
    }
  }

  if (allowedIds) worksQuery = worksQuery.in("id", allowedIds)
  // If only exclude filters are present, apply them via .not(in)
  if (!allowedIds && excludeIds.size > 0) {
    worksQuery = worksQuery.not("id", "in", `(${[...excludeIds].join(",")})`)
  }

  if (publicationStatusIdFilter && publicationStatusIdFilter.length > 0) {
    worksQuery = worksQuery.in("publication_status_id", publicationStatusIdFilter)
  } else if (publicationStatusIdFilter && publicationStatusIdFilter.length === 0) {
    // Filter pediu status que nenhum nome resolve — força match vazio.
    worksQuery = worksQuery.eq("id", "00000000-0000-0000-0000-000000000000")
  }
  if (personalStatusIdFilter && personalStatusIdFilter.length > 0) {
    worksQuery = worksQuery.in("personal_status_id", personalStatusIdFilter)
  } else if (personalStatusIdFilter && personalStatusIdFilter.length === 0) {
    worksQuery = worksQuery.eq("id", "00000000-0000-0000-0000-000000000000")
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
  if (filters.onlyFavorites) {
    worksQuery = worksQuery.eq("is_favorite", true)
  }

  const { data, error } = await worksQuery.order("title").limit(2000)

  if (error) throw new Error(error.message)

  const personalStatusSymbolsById = new Map(
    personalStatusOptions.map((status) => [status.id, status.symbol])
  )
  const publicationStatusDisplayById = new Map(
    publicationStatusOptions.map((status) => [
      status.id,
      { short: status.short, color: status.color },
    ])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: RankingEntry[] = (data ?? []).map((w: any) => {
    const publicationStatusId =
      typeof w.publication_status_id === "number" ? w.publication_status_id : null
    const publicationStatusDisplay = publicationStatusId != null
      ? publicationStatusDisplayById.get(publicationStatusId)
      : undefined
    const personalStatusId =
      typeof w.personal_status_id === "number" ? w.personal_status_id : null
    const scores: Record<string, number> = {}
    for (const cs of w.category_scores ?? []) {
      scores[cs.criterion_slug] = cs.score
    }
    const displayTags = ((w.work_tags ?? [])
      .map((wt: { tags: unknown }) => wt.tags)
      .filter(Boolean) as Array<{ id: string; name: string; slug: string; tag_group_id?: string | null }>)
      .map((tag) => ({ ...tag, tag_group_id: tag.tag_group_id ?? null }))
    const genreNames = ((w.work_genres ?? []) as Array<{ genres?: { name?: string } | null }>)
      .map((wg) => wg.genres?.name)
      .filter((name): name is string => Boolean(name))

    return {
      rank: 0,
      percentile: 0,
      differentiators: [],
      workId: w.id,
      title: w.title,
      finalScore: w.calculated_scores?.final_score ?? null,
      calcScore: w.calculated_scores?.calc_score ?? null,
      predictedScore: w.calculated_scores?.predicted_score ?? null,
      expectedScore: w.calculated_scores?.expected_score ?? null,
      expectedBaseline: w.calculated_scores?.expected_baseline ?? null,
      expectedQualityAdj: w.calculated_scores?.expected_quality_adj ?? null,
      expectedIsStub: w.calculated_scores?.expected_is_stub ?? true,
      platformAvg: w.calculated_scores?.platform_avg ?? null,
      totalVotes: w.calculated_scores?.total_votes ?? 0,
      predictedIsStub: w.calculated_scores?.predicted_is_stub ?? true,
      personalFit: w.calculated_scores?.personal_fit ?? null,
      personalFitPercentile: w.calculated_scores?.personal_fit_percentile ?? null,
      finalScoreConfidence: w.calculated_scores?.final_score_confidence ?? null,
      knnScore: w.calculated_scores?.knn_score ?? null,
      alignmentScore: w.calculated_scores?.alignment_score ?? null,
      alignmentJustification: w.calculated_scores?.alignment_justification ?? null,
      alignmentAt: w.calculated_scores?.alignment_at ?? null,
      alignmentPayload: w.calculated_scores?.alignment_payload ?? null,
      manualScore: w.manual_score,
      isFavorite: Boolean(w.is_favorite),
      publicationStatus: getPublicationStatusNameById(publicationStatusId) ?? "Unknown",
      publicationStatusId,
      publicationStatusShort: publicationStatusDisplay?.short ?? null,
      publicationStatusColor: publicationStatusDisplay?.color ?? null,
      personalStatus: getPersonalStatusNameById(personalStatusId) ?? "To read",
      personalStatusId,
      personalStatusSymbol:
        personalStatusId != null ? personalStatusSymbolsById.get(personalStatusId) ?? null : null,
      aiEvalStatus: w.ai_eval_status,
      totalChapters: w.total_chapters,
      chaptersRead: w.chapters_read ?? null,
      coverUrl: pickPrimaryCover(w.work_covers),
      synopsis: pickPrimarySynopsis(w.work_synopses),
      synopsisQuality: w.synopsis_quality ?? null,
      observations: w.observations ?? null,
      year: w.year ?? null,
      updatedAt: w.updated_at ?? null,
      lastReadAt: w.last_read_at ?? null,
      genres: genreNames,
      scores,
      tags: displayTags,
    }
  })

  // Filtros por critério (min e max para todos os 9)
  for (const slug of CRITERION_SLUGS) {
    const min = filters.criterionMin?.[slug]
    const max = filters.criterionMax?.[slug]
    if (min != null) entries = entries.filter((e) => (e.scores[slug] ?? 0) >= min)
    if (max != null) entries = entries.filter((e) => (e.scores[slug] ?? 10) <= max)
  }

  // Hard filter: ranking/recomendações escondem obras já finalizadas/dropadas.
  // Páginas tipo /titles e /favorites passam includeFinishedDropped=true.
  if (!filters.includeFinishedDropped) {
    entries = entries.filter(
      (e) => !["Finalizado", "Droppado", "Completed", "Dropped"].includes(e.personalStatus)
    )
  }

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
    const rawScore = (value: number | null | undefined) =>
      value == null ? -Infinity : value
    if (field === "title") return m * a.title.localeCompare(b.title)
    if (field === "final_score") {
      const av = rawScore(a.finalScore ?? a.calcScore)
      const bv = rawScore(b.finalScore ?? b.calcScore)
      return m * (av - bv)
    }
    if (field === "calc_score") return m * (rawScore(a.calcScore) - rawScore(b.calcScore))
    if (field === "predicted_score" || field === "pred_score")
      return m * (rawScore(a.predictedScore) - rawScore(b.predictedScore))
    if (field === "expected_score")
      return m * (rawScore(a.expectedScore) - rawScore(b.expectedScore))
    if (field === "platform_avg") return m * (rawScore(a.platformAvg) - rawScore(b.platformAvg))
    if (field === "personal_fit") {
      const av = a.personalFit ?? -Infinity
      const bv = b.personalFit ?? -Infinity
      return m * (av - bv)
    }
    if (field === "knn_score") return m * (rawScore(a.knnScore) - rawScore(b.knnScore))
    if (field === "alignment_score") {
      const av = a.alignmentScore ?? -Infinity
      const bv = b.alignmentScore ?? -Infinity
      return m * (av - bv)
    }
    if (field === "total_votes") return m * (a.totalVotes - b.totalVotes)
    if (field === "chapters_total" || field === "chapters")
      return m * ((a.totalChapters ?? -Infinity) - (b.totalChapters ?? -Infinity))
    if (field === "chapters_read") return m * ((a.chaptersRead ?? -Infinity) - (b.chaptersRead ?? -Infinity))
    if (field === "year") return m * ((a.year ?? -Infinity) - (b.year ?? -Infinity))
    if (field === "synopsis_q") return m * ((a.synopsisQuality?.length ?? 0) - (b.synopsisQuality?.length ?? 0))
    if (field === "updated_at") {
      const av = a.updatedAt ? Date.parse(a.updatedAt) : -Infinity
      const bv = b.updatedAt ? Date.parse(b.updatedAt) : -Infinity
      return m * (av - bv)
    }
    if (field === "last_read_at") {
      const av = a.lastReadAt ? Date.parse(`${a.lastReadAt}T00:00:00Z`) : -Infinity
      const bv = b.lastReadAt ? Date.parse(`${b.lastReadAt}T00:00:00Z`) : -Infinity
      return m * (av - bv)
    }
    if (field === "publication_status") return m * a.publicationStatus.localeCompare(b.publicationStatus)
    if (field === "personal_status") return m * a.personalStatus.localeCompare(b.personalStatus)
    if (field === "ai_eval_status") return m * a.aiEvalStatus.localeCompare(b.aiEvalStatus)
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

  // Top N (depois da ordenação) — registra rank e percentil antes de cortar
  // Percentil é relativo ao pool FILTRADO (não ao DB inteiro). UX = "Top X% do que estou vendo".
  const totalBeforeSlice = entries.length
  entries.forEach((e, i) => {
    e.rank = i + 1
    e.percentile =
      totalBeforeSlice > 0 ? ((totalBeforeSlice - e.rank + 1) / totalBeforeSlice) * 100 : 0
  })

  // Differentiators: pra cada obra, pega ±5 vizinhos no ranking visível, calcula
  // média de cada critério, e identifica os top 2 critérios onde a obra excede
  // a média dos vizinhos por mais de 1.0 ponto. Ajuda o usuário a entender por
  // que essa obra está aqui versus as adjacentes.
  const NEIGHBOR_WINDOW = 5
  const MIN_DIFF = 1.0
  const MAX_DIFFS = 2
  for (let i = 0; i < entries.length; i++) {
    const start = Math.max(0, i - NEIGHBOR_WINDOW)
    const end = Math.min(entries.length, i + NEIGHBOR_WINDOW + 1)
    const neighbors: RankingEntry[] = []
    for (let j = start; j < end; j++) {
      if (j !== i) neighbors.push(entries[j])
    }
    if (neighbors.length === 0) continue
    const diffs: RankingDifferentiator[] = []
    for (const slug of CRITERION_SLUGS) {
      const own = entries[i].scores[slug]
      if (own == null) continue
      let sum = 0
      let count = 0
      for (const n of neighbors) {
        const v = n.scores[slug]
        if (v == null) continue
        sum += v
        count++
      }
      if (count === 0) continue
      const avg = sum / count
      const diff = own - avg
      if (diff >= MIN_DIFF) diffs.push({ slug, diff })
    }
    diffs.sort((a, b) => b.diff - a.diff)
    entries[i].differentiators = diffs.slice(0, MAX_DIFFS)
  }

  if (filters.topN != null && filters.topN > 0) {
    entries = entries.slice(0, filters.topN)
  }

  return entries
}
