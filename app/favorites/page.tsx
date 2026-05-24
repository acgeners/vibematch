import { Heart } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { WorkTable } from "@/components/titles/work-table"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
import { FavoritesStatsHeader } from "@/components/favorites/favorites-stats-header"
import { RecommendWithAiButton } from "@/components/recommendations/recommend-with-ai-button"
import { ViewRecommendationsButton } from "@/components/recommendations/view-recommendations-button"
import { getRanking, type RankingFilters, type SortLevel } from "@/server/queries/ranking"
import { getWorksByIds } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getFavoritesSummary } from "@/server/queries/favorites"
import { CRITERION_SLUGS, PERSONAL_STATUSES, PUBLICATION_STATUSES } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import {
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/constants/criteria"
import { createAdminClient } from "@/lib/supabase/admin"
import { unstable_cache } from "next/cache"

export const dynamic = "force-dynamic"

interface FavoritesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const getAllGenres = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("genres")
      .select("name")
      .order("name")
      .limit(1000)
    return (data ?? [])
      .map((row) => row.name as string | null)
      .filter((name): name is string => Boolean(name))
  },
  ["favorites-genres-v1"],
  { revalidate: 300, tags: ["genres-catalog"] },
)

const getAllTags = unstable_cache(
  async (): Promise<Array<{
    slug: string
    name: string
    tag_group_id: string | null
    groupName: string
  }>> => {
    const supabase = createAdminClient()
    const PAGE = 1000
    const allTags: Array<{ slug: string; name: string; tag_group_id: string | null }> = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("tags")
        .select("slug, name, tag_group_id")
        .order("name")
        .range(offset, offset + PAGE - 1)
      if (error) break
      if (!data || data.length === 0) break
      for (const row of data) {
        allTags.push({
          slug: row.slug,
          name: row.name,
          tag_group_id: row.tag_group_id ?? null,
        })
      }
      if (data.length < PAGE) break
    }
    const { data: groups } = await supabase.from("tag_group").select("id, group, slug")
    const groupById = new Map(
      (groups ?? []).map((group) => [
        group.id as string,
        ((group.group as string | null) ?? (group.slug as string | null) ?? "Sem grupo"),
      ]),
    )
    return allTags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      tag_group_id: tag.tag_group_id,
      groupName: tag.tag_group_id ? groupById.get(tag.tag_group_id) ?? "Sem grupo" : "Sem grupo",
    }))
  },
  ["favorites-tags-v1"],
  { revalidate: 300, tags: ["tags-catalog"] },
)

interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  comment: string | null
}

function mergeStatusOptions(fallbacks: StatusOption[], dbRows: StatusOption[] | null | undefined) {
  const rows = dbRows ?? []
  if (rows.length === 0) return fallbacks
  const byStatus = new Map<string, StatusOption>()
  for (const row of rows) byStatus.set(row.status, row)
  return [...byStatus.values()]
}

const getStatusOptions = unstable_cache(
  async () => {
    const supabase = createAdminClient()
    const [{ data: pubData }, { data: perData }] = await Promise.all([
      supabase.from("publication_status").select("id, status, slug, color, symbol").order("id"),
      supabase.from("personal_status").select("id, status, slug, color, symbol, comment").order("id"),
    ])
    const publicationFallbacks: StatusOption[] = PUBLICATION_STATUSES.map((status, index) => ({
      id: index + 1,
      status: PUBLICATION_STATUS_LABELS[status] ?? status,
      slug: status.toLowerCase(),
      color: null,
      symbol: null,
      comment: null,
    }))
    const personalFallbacks: StatusOption[] = PERSONAL_STATUSES.map((status, index) => ({
      id: index + 1,
      status: PERSONAL_STATUS_LABELS[status] ?? status,
      slug: status.toLowerCase().replaceAll(" ", "-"),
      color: null,
      symbol: null,
      comment: null,
    }))
    return {
      publicationStatuses: mergeStatusOptions(publicationFallbacks, pubData as StatusOption[] | null),
      personalStatuses: mergeStatusOptions(personalFallbacks, perData as StatusOption[] | null),
    }
  },
  ["favorites-status-options-v1"],
  { revalidate: 300 },
)

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default async function FavoritesPage({ searchParams }: FavoritesPageProps) {
  const params = await searchParams

  function str(key: string): string | undefined {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }
  function num(key: string): number | undefined {
    const v = str(key)
    if (!v) return undefined
    const n = parseFloat(v)
    return isNaN(n) ? undefined : n
  }
  function multi(key: string): string[] | undefined {
    const v = str(key)
    if (!v) return undefined
    return v.split(",").map((s) => s.trim()).filter(Boolean)
  }

  const criterionMin: Partial<Record<string, number>> = {}
  const criterionMax: Partial<Record<string, number>> = {}
  for (const slug of CRITERION_SLUGS) {
    const mn = num(`min_${slug}`)
    const mx = num(`max_${slug}`)
    if (mn != null) criterionMin[slug] = mn
    if (mx != null) criterionMax[slug] = mx
  }

  const validSortFields = new Set<string>([
    "final_score", "calc_score", "pred_score", "platform_avg", "total_votes", "chapters", "title", "alignment_score",
    ...CRITERION_SLUGS.map((s) => `crit_${s}`),
  ])
  const rawSort = str("sort") ?? "final_score:desc"
  const sortLevels: SortLevel[] = rawSort.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    return {
      field: (validSortFields.has(field) ? field : "final_score") as SortLevel["field"],
      dir: dir === "asc" ? "asc" : "desc",
    }
  })

  const aiStatuses = multi("ai_status")
  const perStatusParam = str("per_status")
  // Em /favorites o default é "todos" (não filtra por status pessoal),
  // diferente do /ranking que filtra "To read" por padrão.
  const personalStatus =
    perStatusParam === "all" || !perStatusParam
      ? undefined
      : perStatusParam.split(",").map((s) => s.trim()).filter(Boolean)

  const pubStatusParam = str("pub_status")
  const publicationStatus =
    pubStatusParam === "all" || !pubStatusParam
      ? undefined
      : pubStatusParam.split(",").map((s) => s.trim()).filter(Boolean)

  const filters: RankingFilters = {
    search: str("search"),
    criterionMin: Object.keys(criterionMin).length ? criterionMin : undefined,
    criterionMax: Object.keys(criterionMax).length ? criterionMax : undefined,
    publicationStatus,
    personalStatus,
    aiEvalStatus: aiStatuses,
    genreAll: multi("genres_all"),
    genreAny: multi("genres_any") ?? multi("genres"),
    genreExclude: multi("genres_exclude"),
    tagSlugsAll: multi("tags_all"),
    tagSlugsAny: multi("tags_any") ?? multi("tags"),
    tagSlugsExclude: multi("tags_exclude"),
    synopsisQualities: multi("synopsis_q"),
    minTotalChapters: num("min_chapters"),
    maxTotalChapters: num("max_chapters"),
    minCalcScore: num("min_calc"),
    maxCalcScore: num("max_calc"),
    minPredictedScore: num("min_pr"),
    maxPredictedScore: num("max_pr"),
    minFinalScore: num("min_final"),
    maxFinalScore: num("max_final"),
    minPlatformAvg: num("min_platform_avg"),
    maxPlatformAvg: num("max_platform_avg"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    onlyWithFinalScore: str("only_scored") === "1",
    onlyFavorites: true,
    includeFinishedDropped: true,
    sortLevels,
  }

  const [entries, allGenres, allTags, statusOptions, summary, scoreThresholds] = await Promise.all([
    getRanking(filters),
    getAllGenres(),
    getAllTags(),
    getStatusOptions(),
    getFavoritesSummary(),
    getScoreColorThresholds(),
  ])

  const orderedIds = entries.map((e) => e.workId)
  const works = await getWorksByIds(orderedIds)

  return (
    <div className="space-y-4">
      <Header
        kicker="Biblioteca"
        title="Favoritos"
        description="Exploração detalhada das obras marcadas como favoritas."
        icon={<Heart />}
        actions={
          <Badge variant="outline" className="text-sm">
            {works.length} obra{works.length !== 1 ? "s" : ""}
          </Badge>
        }
      />

      <FavoritesStatsHeader summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <RecommendWithAiButton source="favorites" />
        <ViewRecommendationsButton />
      </div>

      <RankingFiltersComponent
        availableGenres={allGenres}
        availableTags={allTags}
        publicationStatuses={statusOptions.publicationStatuses}
        personalStatuses={statusOptions.personalStatuses}
        defaultTopN={null}
        defaultMinCalc={null}
        defaultMinPredicted={null}
        defaultMinFinal={null}
        basePath="/favorites"
        hidePreferencesControls
      />

      <WorkTable
        works={works}
        total={works.length}
        page={1}
        pageSize={works.length || 1}
        searchQuery={str("search")}
        scoreThresholds={scoreThresholds}
        selectedCompareIds={toArray(params.compare).slice(0, MAX_COMPARE_WORKS)}
        namespace="favorites"
        basePath="/favorites"
        enableSelectAll
      />
    </div>
  )
}
