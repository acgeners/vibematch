import { getRanking, type RankingFilters, type RankingSortBy, type SortLevel } from "@/server/queries/ranking"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getLowCoverageWorkIds } from "@/server/queries/calibration-guards"
import { getAllGenres } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getStatusOptions } from "@/server/queries/status-options"
import { Header } from "@/components/layout/header"
import { RankingTable } from "@/components/ranking/ranking-table"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
import { MoodBar } from "@/components/ranking/mood-bar"
import { SurpriseMeButton } from "@/components/ranking/surprise-me-button"
import { MOOD_PRESETS_BY_ID } from "@/lib/constants/mood-presets"
import { RecommendWithAiButton } from "@/components/recommendations/recommend-with-ai-button"
import { Badge } from "@/components/ui/badge"
import { CRITERION_SLUGS } from "@/types/domain"
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

  // Mood preset (?mood=ID) sobrescreve filtros de critério e sort de forma
  // temporária (não persiste). Aplica somente nos critérios que o preset
  // define — campos não-mencionados mantêm valor da URL/preferências.
  const moodId = str("mood")
  const moodPreset = moodId ? MOOD_PRESETS_BY_ID[moodId] : null
  if (moodPreset) {
    if (moodPreset.criterionMin) {
      for (const [slug, value] of Object.entries(moodPreset.criterionMin)) {
        if (value != null) criterionMin[slug] = value
      }
    }
    if (moodPreset.criterionMax) {
      for (const [slug, value] of Object.entries(moodPreset.criterionMax)) {
        if (value != null) criterionMax[slug] = value
      }
    }
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
  // Default: ordenação única por Nota Esperada (expected_score) descendente.
  const rawSort = str("sort") ?? "expected_score:desc"
  let sortLevels: SortLevel[] = rawSort.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    return {
      field: (validSortFields.has(field) ? field : "expected_score") as RankingSortBy,
      dir: dir === "asc" ? "asc" : "desc",
    }
  })
  // Mood com sortField sobrescreve o nível 1 (mais peso ao critério do mood)
  // e mantém os demais níveis como fallback estável.
  if (moodPreset?.sortField) {
    const moodField = `crit_${moodPreset.sortField}` as RankingSortBy
    sortLevels = [{ field: moodField, dir: "desc" }, ...sortLevels.filter((l) => l.field !== moodField)]
  }

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

  const [rawEntries, scoreThresholds, lowCoverageIds] = await Promise.all([
    getRanking(filters),
    getScoreColorThresholds(),
    getLowCoverageWorkIds(),
  ])
  // Marca obras não-lidas com baixa cobertura de gênero (badge ⚠ na Nota esperada).
  const entries = rawEntries.map((e) => ({ ...e, lowCoverage: lowCoverageIds.has(e.workId) }))

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
            <SurpriseMeButton entries={entries} />
            <RecommendWithAiButton source="ranking" />
          </div>
        }
      />

      <MoodBar />

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
