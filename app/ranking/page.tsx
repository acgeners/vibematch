import { getRanking, type RankingFilters, type RankingSortBy, type SortLevel } from "@/server/queries/ranking"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { Header } from "@/components/layout/header"
import { RankingTable } from "@/components/ranking/ranking-table"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
import { RerankButton } from "@/components/ranking/rerank-button"
import { Badge } from "@/components/ui/badge"
import { CRITERION_SLUGS, PERSONAL_STATUSES, PUBLICATION_STATUSES } from "@/types/domain"
import {
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/constants/criteria"
import { createAdminClient } from "@/lib/supabase/admin"
import type { FormulaConfig } from "@/types/domain"
import { unstable_cache } from "next/cache"

interface RankingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const getPreferences = unstable_cache(async (): Promise<{
  topN: number | null
  minCalc: number | null
  minPredicted: number | null
  minFinal: number | null
}> => {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("formula_config")
    .select("top_n, min_calc_score, min_predicted_score, min_final_score")
    .limit(1)
    .single()
  const cfg = data as Pick<FormulaConfig, "top_n" | "min_calc_score" | "min_predicted_score" | "min_final_score"> | null
  return {
    topN: cfg?.top_n ?? null,
    minCalc: cfg?.min_calc_score ?? null,
    minPredicted: cfg?.min_predicted_score ?? null,
    minFinal: cfg?.min_final_score ?? null,
  }
}, ["ranking-preferences"], { revalidate: 300 })

const getAllGenres = unstable_cache(async (): Promise<string[]> => {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("genres")
    .select("name")
    .order("name")
    .limit(1000)
  return (data ?? [])
    .map((row) => row.name as string | null)
    .filter((name): name is string => Boolean(name))
}, ["ranking-genres-v2"], { revalidate: 300, tags: ["genres-catalog"] })

const getAllTags = unstable_cache(async (): Promise<Array<{
  slug: string
  name: string
  tag_group_id: string | null
  groupName: string
}>> => {
  const supabase = createAdminClient()
  // Supabase has a default 1000-row cap per request that `.limit()` does not
  // override — paginate explicitly to fetch every tag.
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
    ])
  )
  return allTags.map((tag) => ({
    slug: tag.slug,
    name: tag.name,
    tag_group_id: tag.tag_group_id,
    groupName: tag.tag_group_id ? groupById.get(tag.tag_group_id) ?? "Sem grupo" : "Sem grupo",
  }))
}, ["ranking-tags-v2"], { revalidate: 300, tags: ["tags-catalog"] })

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
  for (const row of rows) {
    byStatus.set(row.status, row)
  }
  return [...byStatus.values()]
}

const getStatusOptions = unstable_cache(async () => {
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
}, ["ranking-status-options-v4"], { revalidate: 300 })

export default async function RankingPage({ searchParams }: RankingPageProps) {
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
    "final_score", "calc_score", "pred_score", "platform_avg", "total_votes", "chapters", "title", "personal_fit", "final_confidence", "knn_score", "alignment_score",
    ...CRITERION_SLUGS.map((s) => `crit_${s}`),
  ])
  const rawSort = str("sort") ?? "final_score:desc"
  const sortLevels: SortLevel[] = rawSort.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    return {
      field: (validSortFields.has(field) ? field : "final_score") as RankingSortBy,
      dir: dir === "asc" ? "asc" : "desc",
    }
  })

  const aiStatus = str("ai_status")
  const perStatusParam = str("per_status")
  const personalStatus =
    perStatusParam === "all"
      ? undefined
      : perStatusParam
        ? perStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["To read"]

  const pubStatusParam = str("pub_status")
  const publicationStatus =
    pubStatusParam === "all"
      ? undefined
      : pubStatusParam
        ? pubStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Completed"]

  const [prefs, allGenres, allTags, statusOptions] = await Promise.all([
    getPreferences(),
    getAllGenres(),
    getAllTags(),
    getStatusOptions(),
  ])

  // URL pode sobrescrever as preferências (ex: usuário ajusta direto na barra)
  const overrideTopN = num("top_n")
  const overrideMinCalc = num("min_calc")
  const overrideMinPredicted = num("min_pr")
  const overrideMinFinal = num("min_final")

  const filters: RankingFilters = {
    criterionMin: Object.keys(criterionMin).length ? criterionMin : undefined,
    criterionMax: Object.keys(criterionMax).length ? criterionMax : undefined,
    publicationStatus,
    personalStatus: personalStatus?.length ? personalStatus : undefined,
    aiEvalStatus: aiStatus ? [aiStatus] : undefined,
    genreAll: multi("genres_all"),
    genreAny: multi("genres_any") ?? multi("genres"),
    genreExclude: multi("genres_exclude"),
    tagSlugsAll: multi("tags_all"),
    tagSlugsAny: multi("tags_any") ?? multi("tags"),
    tagSlugsExclude: multi("tags_exclude"),
    synopsisQualities: multi("synopsis_q"),
    minTotalChapters: num("min_chapters"),
    maxTotalChapters: num("max_chapters"),
    minCalcScore: overrideMinCalc ?? prefs.minCalc ?? undefined,
    maxCalcScore: num("max_calc"),
    minPredictedScore: overrideMinPredicted ?? prefs.minPredicted ?? undefined,
    maxPredictedScore: num("max_pr"),
    minFinalScore: overrideMinFinal ?? prefs.minFinal ?? undefined,
    maxFinalScore: num("max_final"),
    minPlatformAvg: num("min_platform_avg"),
    maxPlatformAvg: num("max_platform_avg"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    topN: overrideTopN ?? prefs.topN ?? undefined,
    onlyWithFinalScore: str("only_scored") === "1",
    onlyFavorites: str("fav") === "1",
    sortLevels,
  }

  const [entries, scoreThresholds] = await Promise.all([
    getRanking(filters),
    getScoreColorThresholds(),
  ])

  return (
    <div className="space-y-4">
      <Header
        kicker="Ranking"
        title="Ranking"
        description="Obras ordenadas pela Nota.Final"
        actions={
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-sm">
              {entries.length} obra{entries.length !== 1 ? "s" : ""}
            </Badge>
            <RerankButton topN={Math.min(50, entries.length)} />
          </div>
        }
      />

      <RankingFiltersComponent
        availableGenres={allGenres}
        availableTags={allTags}
        publicationStatuses={statusOptions.publicationStatuses}
        personalStatuses={statusOptions.personalStatuses}
        defaultTopN={prefs.topN}
        defaultMinCalc={prefs.minCalc}
        defaultMinPredicted={prefs.minPredicted}
        defaultMinFinal={prefs.minFinal}
      />

      <RankingTable entries={entries} scoreThresholds={scoreThresholds} />
    </div>
  )
}
