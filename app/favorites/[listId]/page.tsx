import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, FolderOpen, Heart, Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { WorkTable } from "@/components/titles/work-table"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
import { FavoritesStatsHeader } from "@/components/favorites/favorites-stats-header"
import { RecommendDialog } from "@/components/recommendations/recommend-dialog"
import { ViewRecommendationsButton } from "@/components/recommendations/view-recommendations-button"
import { GroupDetailActions } from "@/components/favorites/lists/group-detail-actions"
import { GroupRecommendButton } from "@/components/favorites/lists/group-recommend-button"
import { canConsumeAi } from "@/server/queries/current-user"
import { getRanking, type RankingFilters, type SortLevel } from "@/server/queries/ranking"
import { getWorksByIds } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getCriterionColorRanges } from "@/server/queries/criterion-prefs"
import { getFavoritesSummary } from "@/server/queries/favorites"
import { getListDetail, getUngroupedFavorites, getWorksLiteForPicker, getListRecommendations, getListsForPicker } from "@/server/queries/lists"
import { getAllGenres } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getStatusOptions } from "@/server/queries/status-options"
import { getFilterPresets } from "@/server/queries/filter-presets"
import { CRITERION_SLUGS } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"

interface FavoritesListPageProps {
  params: Promise<{ listId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default async function FavoritesListPage({ params, searchParams }: FavoritesListPageProps) {
  const { listId } = await params
  // Dois ids RESERVADOS: nenhum dos dois é um `work_lists`. "all" é o universo de favoritos;
  // "ungrouped" é a visão derivada das favoritas fora de qualquer grupo. Ambos são
  // somente-leitura: não têm o que editar, comentar ou excluir.
  const isAll = listId === "all"
  const isUngrouped = listId === "ungrouped"
  const isPseudo = isAll || isUngrouped

  // Grupo real: carrega metadados + escopo. Grupo inexistente volta ao índice.
  const listDetail = isPseudo ? null : await getListDetail(listId)
  if (!isPseudo && !listDetail) redirect("/favorites")

  // "Sem grupo" sem grupo nenhum não é uma visão — é "Todos os favoritos" com outro nome.
  // O card nem aparece nesse caso; quem chegar pela URL volta ao índice.
  const ungrouped = isUngrouped ? await getUngroupedFavorites() : null
  if (isUngrouped && ungrouped!.groupCount === 0) redirect("/favorites")

  const basePath = `/favorites/${listId}`
  const params_ = await searchParams

  function str(key: string): string | undefined {
    const v = params_[key]
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
    "decision",
    "expected_score", "expected_baseline", "expected_quality_adj", "personal_fit",
    "alignment_score",
    "platform_avg", "total_votes",
    "title", "year", "synopsis_q",
    "chapters", "chapters_total", "chapters_read",
    "publication_status", "personal_status", "ai_eval_status",
    "updated_at", "last_read_at",
    ...CRITERION_SLUGS.map((s) => `crit_${s}`),
  ])
  const rawSort = str("sort") ?? "expected_score:desc"
  const sortLevels: SortLevel[] = rawSort.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    return {
      field: (validSortFields.has(field) ? field : "expected_score") as SortLevel["field"],
      dir: dir === "asc" ? "asc" : "desc",
    }
  })

  const aiStatuses = multi("ai_status")
  const perStatusParam = str("per_status")
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
    predictedSynopsisQualities: multi("synopsis_pred"),
    interestMode: str("synopsis_mode") === "and" ? "and" : "or",
    minTotalChapters: num("min_chapters"),
    maxTotalChapters: num("max_chapters"),
    minYear: num("min_year"),
    maxYear: num("max_year"),
    minExpectedScore: num("min_expected"),
    maxExpectedScore: num("max_expected"),
    minPersonalFitPct: num("min_fit"),
    maxPersonalFitPct: num("max_fit"),
    minAlignment: num("min_align"),
    maxAlignment: num("max_align"),
    minPlatformAvg: num("min_platform_avg"),
    maxPlatformAvg: num("max_platform_avg"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    onlyWithFinalScore: str("only_scored") === "1",
    onlyWithoutFinalScore: str("no_score") === "1",
    // "Todos": universo de favoritos. "Sem grupo": favoritas menos as agrupadas (a query já
    // resolveu o conjunto). Grupo real: escopo pelos IDs do grupo.
    onlyFavorites: isPseudo,
    onlyWorkIds: isAll ? undefined : isUngrouped ? ungrouped!.workIds : listDetail!.workIds,
    includeFinishedDropped: true,
    sortLevels,
  }

  const [entries, allGenres, allTags, statusOptions, favSummary, scoreThresholds, savedPresets, criterionPrefs, canAi, catalog, recentRecs, allGroups] =
    await Promise.all([
      getRanking(filters),
      getAllGenres(),
      getAllTags(),
      getStatusOptions(),
      isAll ? getFavoritesSummary() : Promise.resolve(null),
      getScoreColorThresholds(),
      getFilterPresets(basePath),
      getCriterionColorRanges(),
      canConsumeAi(),
      isPseudo ? Promise.resolve([]) : getWorksLiteForPicker(),
      isPseudo ? Promise.resolve([]) : getListRecommendations(listId),
      getListsForPicker(),
    ])

  // Destinos do "Adicionar a grupo": todos os grupos, menos o atual (numa página de grupo).
  const groupOptions = isPseudo ? allGroups : allGroups.filter((g) => g.id !== listId)

  const orderedIds = entries.map((e) => e.workId)
  const works = await getWorksByIds(orderedIds)
  const isPaid = canAi

  const entryById = new Map(entries.map((e) => [e.workId, e]))
  const worksWithPred = works.map((w) => {
    const e = entryById.get(w.id)
    if (!e) return w
    return {
      ...w,
      predicted_synopsis_quality: e.predictedSynopsisQuality as SynopsisQuality | null,
      predicted_synopsis_stale: e.predictedSynopsisStale,
      predicted_synopsis_confidence: e.predictedSynopsisConfidence,
    }
  })

  const summary = isAll ? favSummary! : isUngrouped ? ungrouped!.summary : listDetail!.summary
  const title = isAll ? "Todos os favoritos" : isUngrouped ? "Sem grupo" : listDetail!.name
  const description = isAll
    ? "Exploração detalhada das obras marcadas como favoritas."
    : isUngrouped
      ? "Favoritas que ainda não entraram em nenhum grupo — a fila do que falta organizar."
      : listDetail!.description ?? "Recorte dos seus favoritos pra comparar em um contexto."
  const kicker = isAll ? "Biblioteca" : isUngrouped ? "Visão derivada" : "Grupo"

  return (
    <div className="space-y-4">
      <Link
        href="/favorites"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Favoritos
      </Link>

      <Header
        kicker={kicker}
        title={title}
        description={description}
        icon={isUngrouped ? <FolderOpen /> : <Heart />}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className="text-sm">
              {works.length} obra{works.length !== 1 ? "s" : ""}
            </Badge>
            {!isPseudo && listDetail && (
              <GroupDetailActions
                list={{
                  id: listDetail.id,
                  name: listDetail.name,
                  description: listDetail.description,
                  color: listDetail.color,
                  coverWorkIds: listDetail.coverWorkIds,
                }}
                memberIds={listDetail.workIds}
                catalog={catalog}
                comments={listDetail.comments}
              />
            )}
          </div>
        }
      />

      <FavoritesStatsHeader
        summary={summary}
        scoreThresholds={scoreThresholds?.expected ?? null}
        shownCount={worksWithPred.length}
        actions={
          <>
            {isAll && <RecommendDialog context="favorites" isPaid={isPaid} />}
            {/* "Sem grupo" não oferece recomendar: o botão de favoritos rodaria sobre TODOS os
                favoritos, não sobre este recorte — prometeria um escopo que não entrega. */}
            {!isPseudo && (
              <GroupRecommendButton listId={listId} workCount={listDetail!.workIds.length} isPaid={isPaid} />
            )}
            <ViewRecommendationsButton />
          </>
        }
      />

      {!isPseudo && recentRecs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Sparkles className="size-3.5 text-primary" /> Recomendações deste grupo
          </span>
          {recentRecs.map((r) => (
            <Link key={r.slug} href={`/recommendations/${r.slug}`} className="text-primary hover:underline">
              {r.slug}
            </Link>
          ))}
        </div>
      )}

      <RankingFiltersComponent
        availableGenres={allGenres}
        availableTags={allTags}
        publicationStatuses={statusOptions.publicationStatuses}
        personalStatuses={statusOptions.personalStatuses}
        defaultTopN={null}
        basePath={basePath}
        savedPresets={savedPresets}
        showTopN={false}
        showTierBand={false}
      />

      <WorkTable
        works={worksWithPred}
        total={worksWithPred.length}
        page={1}
        pageSize={worksWithPred.length || 1}
        searchQuery={str("search")}
        scoreThresholds={scoreThresholds}
        criterionPrefs={criterionPrefs}
        selectedCompareIds={toArray(params_.compare).slice(0, MAX_COMPARE_WORKS)}
        namespace="favorites"
        basePath={basePath}
        enableSelectAll
        isPaid={isPaid}
        groups={groupOptions}
        // Só num grupo REAL há de onde remover — em /all e /ungrouped a ação não existe.
        currentGroup={isPseudo ? undefined : { id: listId, name: listDetail!.name }}
      />
    </div>
  )
}
