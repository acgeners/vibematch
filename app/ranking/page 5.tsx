import { getRanking, type RankingFilters, type RankingSortBy, type SortLevel } from "@/server/queries/ranking"
import { Header } from "@/components/layout/header"
import { RankingTable } from "@/components/ranking/ranking-table"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
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
    .from("works")
    .select("genres")
    .eq("is_archived", false)
    .limit(2000)
  const set = new Set<string>()
  for (const row of data ?? []) {
    const arr = Array.isArray((row as { genres?: unknown }).genres) ? (row as { genres: string[] }).genres : []
    for (const g of arr) if (g) set.add(g)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}, ["ranking-genres"], { revalidate: 300 })

const getAllTags = unstable_cache(async (): Promise<Array<{ slug: string; name: string }>> => {
  const supabase = createAdminClient()
  const { data } = await supabase.from("tags").select("slug, name").order("name").limit(500)
  return (data ?? []) as Array<{ slug: string; name: string }>
}, ["ranking-tags"], { revalidate: 300 })

interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  previous: string
  comment: string | null
}

function mergeStatusOptions(fallbacks: StatusOption[], dbRows: StatusOption[] | null | undefined) {
  const rows = dbRows ?? []
  if (rows.length === 0) return fallbacks

  const byStatus = new Map<string, StatusOption>()
  for (const row of rows) {
    byStatus.set(row.status, {
      ...row,
      previous: row.previous ?? row.status,
    })
  }
  return [...byStatus.values()]
}

const getStatusOptions = unstable_cache(async () => {
  const supabase = createAdminClient()
  const [{ data: pubData }, { data: perData }] = await Promise.all([
    supabase.from("publication_status").select("id, status, slug, color, symbol, previous").order("id"),
    supabase.from("personal_status").select("id, status, slug, color, symbol, previous, comment").order("id"),
  ])
  const publicationFallbacks: StatusOption[] = PUBLICATION_STATUSES.map((status, index) => ({
    id: index + 1,
    status: PUBLICATION_STATUS_LABELS[status] ?? status,
    slug: status.toLowerCase(),
    color: null,
    symbol: null,
    previous: status,
    comment: null,
  }))
  const personalFallbacks: StatusOption[] = PERSONAL_STATUSES.map((status, index) => ({
    id: index + 1,
    status: PERSONAL_STATUS_LABELS[status] ?? status,
    slug: status.toLowerCase().replaceAll(" ", "-"),
    color: null,
    symbol: null,
    previous: status,
    comment: null,
  }))
  return {
    publicationStatuses: mergeStatusOptions(publicationFallbacks, pubData as StatusOption[] | null),
    personalStatuses: mergeStatusOptions(personalFallbacks, perData as StatusOption[] | null),
  }
}, ["ranking-status-options-v3"], { revalidate: 300 })

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
    "final_score", "calc_score", "pred_score", "chapters", "title",
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
        : undefined

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
    publicationStatus: multi("pub_status"),
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
    minPredictedScore: overrideMinPredicted ?? prefs.minPredicted ?? undefined,
    minFinalScore: overrideMinFinal ?? prefs.minFinal ?? undefined,
    topN: overrideTopN ?? prefs.topN ?? undefined,
    onlyWithFinalScore: str("only_scored") === "1",
    sortLevels,
  }

  const entries = await getRanking(filters)

  return (
    <div className="space-y-4">
      <Header
        title="Ranking"
        description="Obras ordenadas pela Nota.Final"
        actions={
          <Badge variant="outline" className="text-sm">
            {entries.length} obra{entries.length !== 1 ? "s" : ""}
          </Badge>
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

      <RankingTable entries={entries} />
    </div>
  )
}
