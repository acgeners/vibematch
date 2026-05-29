import Link from "next/link"
import { Plus } from "lucide-react"
import { getRanking, type RankingFilters, type RankingSortBy, type SortLevel } from "@/server/queries/ranking"
import { getWorksByIds } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getAllGenres } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getStatusOptions } from "@/server/queries/status-options"
import { Header } from "@/components/layout/header"
import { TitleFilters } from "@/components/titles/title-filters"
import { WorkTable } from "@/components/titles/work-table"
import { Button } from "@/components/ui/button"
import { CRITERION_SLUGS } from "@/types/domain"

interface TitlesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TitlesPage({ searchParams }: TitlesPageProps) {
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

  // Whitelist espelha `RankingSortBy` em server/queries/ranking.ts.
  // Sem o expected_*, sort por "Esperada" caía silenciosamente em final_score.
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
      field: (validSortFields.has(field) ? field : "final_score") as RankingSortBy,
      dir: dir === "asc" ? "asc" : "desc",
    }
  })

  const aiStatuses = multi("ai_status")
  const perStatusParam = str("per_status")
  // /titles default: sem filtro de status pessoal (mostra tudo).
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
    includeArchived: str("archived") === "1",
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
    topN: num("top_n"),
    onlyWithFinalScore: str("only_scored") === "1",
    onlyFavorites: str("fav") === "1",
    includeFinishedDropped: true,
    sortLevels,
  }

  const pageSize = 50
  const page = Math.max(1, parseInt(str("page") ?? "1", 10))

  const [entries, allGenres, allTags, statusOptions, scoreThresholds] = await Promise.all([
    getRanking(filters),
    getAllGenres(),
    getAllTags(),
    getStatusOptions(),
    getScoreColorThresholds(),
  ])

  const total = entries.length
  const offset = (page - 1) * pageSize
  const pageIds = entries.slice(offset, offset + pageSize).map((e) => e.workId)
  const works = await getWorksByIds(pageIds)

  return (
    <div className="space-y-4">
      <Header
        className="sm:items-start"
        kicker="Catálogo"
        title="Títulos"
        description={`${total} obra${total !== 1 ? "s" : ""} no catálogo`}
        actions={
          <Button asChild size="sm">
            <Link href="/titles/new">
              <Plus className="h-4 w-4 mr-1" />
              Novo título
            </Link>
          </Button>
        }
      />

      <TitleFilters
        availableGenres={allGenres}
        availableTags={allTags}
        publicationStatuses={statusOptions.publicationStatuses}
        personalStatuses={statusOptions.personalStatuses}
      />

      <WorkTable
        works={works}
        total={total}
        page={page}
        pageSize={pageSize}
        searchQuery={str("search")}
        scoreThresholds={scoreThresholds}
        enableCompare={false}
        enableHeatmap={false}
      />
    </div>
  )
}
