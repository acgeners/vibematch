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
import { getAllGenres } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getStatusOptions } from "@/server/queries/status-options"
import { CRITERION_SLUGS } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"

interface FavoritesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

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

  // Whitelist de campos de sort permitidos via URL — espelha
  // `RankingSortBy` em server/queries/ranking.ts (e os keys expostos em
  // sortableColumns de work-table.tsx). Mantido como Set pra rejeitar
  // valores inválidos vindos da URL sem cair em erro 500.
  const validSortFields = new Set<string>([
    // Notas (novo pipeline)
    "expected_score", "expected_baseline", "expected_quality_adj", "personal_fit",
    // Notas (legado)
    "final_score", "calc_score", "predicted_score", "pred_score", "alignment_score",
    "knn_score",
    // Plataforma
    "platform_avg", "total_votes",
    // Metadata
    "title", "year", "synopsis_q",
    "chapters", "chapters_total", "chapters_read",
    "publication_status", "personal_status", "ai_eval_status",
    "updated_at", "last_read_at",
    // Critérios IA
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

      <FavoritesStatsHeader summary={summary} scoreThresholds={scoreThresholds?.final ?? null} />

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
