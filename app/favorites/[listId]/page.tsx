import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { sanitizeInterestSelection } from "@/lib/interest-sentinels"
import Link from "next/link"
import { ChevronLeft, FolderOpen, Heart, Layers, Sparkles } from "lucide-react"
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
import { getListDetail, getListName, getUngroupedFavorites, getWorksLiteForPicker, getListRecommendations, getListsForPicker, getGroupMembership, getMultiGroupFavorites, groupCountsFrom } from "@/server/queries/lists"
import { getAllGenres } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getStatusOptions } from "@/server/queries/status-options"
import { getFilterPresets } from "@/server/queries/filter-presets"
import { getCriterionMomentsSafe } from "@/server/queries/criterion-moments"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { STRONG_TAG_WEIGHT } from "@/lib/tags/segment"
import { CRITERION_SLUGS } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import { readStatusFilter } from "@/lib/status-filter-toggle"
import { parseArtFilter } from "@/lib/arte/url"
import { getScoresReader } from "@/server/queries/user-scores"
import { getVerdictScale } from "@/server/queries/verdict-scale"

interface FavoritesListPageProps {
  params: Promise<{ listId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// Os mesmos quatro casos do `title` do Header abaixo (linha ~230): os três ids reservados e o
// nome do grupo. Grupo apagado ou de outra pessoa cai em "Favoritos" — a página redireciona
// pro índice de qualquer jeito.
export async function generateMetadata({ params }: FavoritesListPageProps): Promise<Metadata> {
  const { listId } = await params
  if (listId === "all") return { title: "Todos os favoritos" }
  if (listId === "ungrouped") return { title: "Sem grupo" }
  if (listId === "multi") return { title: "Em vários grupos" }
  return { title: (await getListName(listId)) ?? "Favoritos" }
}

export default async function FavoritesListPage({ params, searchParams }: FavoritesListPageProps) {
  const { listId } = await params
  // TRÊS ids RESERVADOS: nenhum deles é um `work_lists`. "all" é o universo de favoritos;
  // "ungrouped" é a visão derivada das favoritas fora de qualquer grupo; "multi", das que
  // estão em 2+ recortes. Os três são somente-leitura: não têm o que editar, comentar ou
  // excluir.
  const isAll = listId === "all"
  const isUngrouped = listId === "ungrouped"
  const isMulti = listId === "multi"
  const isPseudo = isAll || isUngrouped || isMulti

  // Grupo real: carrega metadados + escopo. Grupo inexistente volta ao índice.
  const listDetail = isPseudo ? null : await getListDetail(listId)
  if (!isPseudo && !listDetail) redirect("/favorites")

  // "Sem grupo" sem grupo nenhum não é uma visão — é "Todos os favoritos" com outro nome.
  // O card nem aparece nesse caso; quem chegar pela URL volta ao índice.
  const ungrouped = isUngrouped ? await getUngroupedFavorites() : null
  if (isUngrouped && ungrouped!.groupCount === 0) redirect("/favorites")

  // Mesma regra para "Em vários grupos": sem interseção nenhuma a visão não existe. O card
  // já se esconde nesse caso — isto cobre quem chega pela URL (link salvo, histórico).
  // `multiFavs`, não `multi`: já existe um helper `multi(key)` para params de valor múltiplo
  // nesta página, e o nome curto colidiria com ele.
  const multiFavs = isMulti ? await getMultiGroupFavorites() : null
  if (isMulti && multiFavs!.workIds.length === 0) redirect("/favorites")

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
    "groups",
    "decision",
    "expected_score", "expected_baseline", "expected_quality_adj", "personal_fit",
    "user_score",
    "alignment_score",
    "platform_avg", "total_votes",
    "title", "year", "synopsis_q", "synopsis_pred",
    "chapters", "chapters_total", "chapters_read",
    "publication_status", "personal_status", "ai_eval_status",
    "updated_at", "last_read_at",
    ...CRITERION_SLUGS.map((s) => `crit_${s}`),
  ])
  // Em "Em vários grupos" a recorrência é o assunto da página, então ela ordena — com a
  // Prevista logo abaixo, porque a recorrência empata muito (são 4 valores possíveis hoje).
  // Nas demais visões o default segue o de sempre.
  //
  // 🔴 UMA constante para os dois lados. O painel de filtros tem um default PRÓPRIO
  // (`expected_score:desc`) e, sem receber este, ele desenhava "N. Prevista · 1 nível"
  // sobre uma lista ordenada por Grupos — e o "Aplicar filtros" seguinte reescrevia a URL
  // com o que o painel achava que era a ordem, apagando a ordenação da página. Medido na
  // tela em 2026-08-15.
  const defaultSort = isMulti ? "groups:desc,expected_score:desc" : "expected_score:desc"
  const rawSort = str("sort") ?? defaultSort
  const sortLevels: SortLevel[] = rawSort.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    return {
      field: (validSortFields.has(field) ? field : "expected_score") as SortLevel["field"],
      dir: dir === "asc" ? "asc" : "desc",
    }
  })

  const aiStatuses = multi("ai_status")
  // Sem defaults, ao contrário do /ranking: aqui a ausência do parâmetro já significa
  // "sem filtro" (ver `defaultPublicationStatus="all"` passado ao painel, mais abaixo).
  const personalFilter = readStatusFilter(str, "personal")
  const publicationFilter = readStatusFilter(str, "publication")

  // Filtro opt-in "esconder minhas tags evitadas" (mesmo padrão de /ranking, ver
  // app/ranking/page.tsx) — off | "strong" (só as evitadas com ênfase 2×) | "all".
  const hideMode = str("hide_avoided") // "strong" | "all" | undefined
  const hideActive = hideMode === "strong" || hideMode === "all"
  const declaredPrefs = hideActive ? await getDeclaredTagPreferences() : []
  const avoided = declaredPrefs.filter((p) => p.stance === "avoid")
  const avoidedSlugs =
    hideMode === "all"
      ? avoided.map((p) => p.slug)
      : hideMode === "strong"
        ? avoided.filter((p) => p.weight >= STRONG_TAG_WEIGHT).map((p) => p.slug)
        : []

  // Conteúdo 18+ por-página (?adult=hide|only), mesmo padrão de /ranking. Usa
  // works.is_adult; ausente respeita a preferência global do usuário.
  const adultParam = str("adult")
  const adultFilter = adultParam === "hide" || adultParam === "only" ? adultParam : undefined

  // Estimativa de arte (?art=forte|sem_fraca). Faixa, nunca pontos — ver lib/arte/url.ts.
  const artFilter = parseArtFilter(str("art"))
  // 🔴 Quem NÃO é o dono não tem estimativa de arte (o overlay a anula), então o controle
  // não pode aparecer: "Forte" devolveria vazio, indistinguível de "não há obra com arte
  // forte". `cache()` no reader ⇒ sem round-trip extra.
  const artScoresReader = await getScoresReader()
  // Régua do Veredito (migration 193) — descreve o catálogo, então vem do servidor.
  const verdictScale = await getVerdictScale()

  // Recorrência: um mapa só alimenta a ORDENAÇÃO (via getRanking) e a CÉLULA (via
  // WorkTable). Duas contagens independentes é como a coluna passaria a mostrar um número
  // e a ordem a obedecer outro — ver "DOIS critérios para o MESMO fato" no CLAUDE.md.
  // `cache()` no reader ⇒ sem round-trip extra, mesmo com o `getListsForPicker` abaixo.
  const membership = await getGroupMembership()

  const filters: RankingFilters = {
    search: str("search"),
    criterionMin: Object.keys(criterionMin).length ? criterionMin : undefined,
    criterionMax: Object.keys(criterionMax).length ? criterionMax : undefined,
    publicationStatus: publicationFilter.include,
    publicationStatusExclude: publicationFilter.exclude,
    personalStatus: personalFilter.include,
    personalStatusExclude: personalFilter.exclude,
    aiEvalStatus: aiStatuses,
    genreAll: multi("genres_all"),
    genreAny: multi("genres_any") ?? multi("genres"),
    genreExclude: multi("genres_exclude"),
    tagSlugsAll: multi("tags_all"),
    tagSlugsAny: multi("tags_any") ?? multi("tags"),
    tagSlugsExclude: (() => {
      const fromUrl = multi("tags_exclude") ?? []
      const merged = [...new Set([...fromUrl, ...avoidedSlugs])]
      return merged.length ? merged : undefined
    })(),
    synopsisQualities: sanitizeInterestSelection(multi("synopsis_q")),
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
    // resolveu o conjunto). "Em vários grupos": as que aparecem em 2+ recortes. Grupo real:
    // escopo pelos IDs do grupo.
    onlyFavorites: isPseudo,
    onlyWorkIds: isAll
      ? undefined
      : isUngrouped
        ? ungrouped!.workIds
        : isMulti
          ? multiFavs!.workIds
          : listDetail!.workIds,
    includeFinishedDropped: true,
    adultFilter,
    artFilter,
    groupCountByWorkId: groupCountsFrom(membership),
    sortLevels,
  }

  const [entries, allGenres, allTags, statusOptions, favSummary, scoreThresholds, savedPresets, criterionPrefs, canAi, catalog, recentRecs, allGroups, criterionMoments] =
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
      // Habilita a lente σ do filtro de critério. Nada mais muda aqui: a query
      // string continua em pontos, então esta página não sabe (nem precisa saber)
      // o que é σ — a conversão é toda de exibição, dentro do componente.
      getCriterionMomentsSafe(),
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

  const summary = isAll
    ? favSummary!
    : isUngrouped
      ? ungrouped!.summary
      : isMulti
        ? multiFavs!.summary
        : listDetail!.summary
  const title = isAll
    ? "Todos os favoritos"
    : isUngrouped
      ? "Sem grupo"
      : isMulti
        ? "Em vários grupos"
        : listDetail!.name
  const description = isAll
    ? "Exploração detalhada das obras marcadas como favoritas."
    : isUngrouped
      ? "Favoritas que ainda não entraram em nenhum grupo — a fila do que falta organizar."
      : isMulti
        ? "Obras que você fichou em mais de um recorte — onde seus recortes se cruzam."
        : listDetail!.description ?? "Recorte dos seus favoritos pra comparar em um contexto."
  const kicker = isAll ? "Biblioteca" : isPseudo ? "Visão derivada" : "Grupo"

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
        icon={isUngrouped ? <FolderOpen /> : isMulti ? <Layers /> : <Heart />}
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
        // Ausência de pub_status/per_status já significa "sem filtro" pro getRanking
        // acima (nenhum default é aplicado) — "all" faz o painel mostrar isso
        // corretamente (chips todos marcados, nada em "Filtros ativos"), em vez do
        // "Completed"/"Want to Read" hardcoded de /ranking, que aqui seria mentira.
        defaultPublicationStatus="all"
        defaultPersonalStatus="all"
        // O MESMO default que o `rawSort` acima usa — ver o 🔴 lá.
        defaultSort={defaultSort}
        defaultTopN={null}
        basePath={basePath}
        criterionMoments={criterionMoments}
        // Mesmas faixas que a WorkTable abaixo já usa no modo de cor "Minha
        // faixa" — aqui elas também FILTRAM. Uma leitura só (`criterionPrefs`)
        // alimenta os dois: derivar de novo é como cor e filtro passam a
        // discordar sobre o que está "dentro".
        criterionRanges={criterionPrefs}
        savedPresets={savedPresets}
        showTopN={false}
        showTierBand={false}
        showHideAvoided
        showArtFilter={artScoresReader.isOwner}
        // A recorrência só é ordenável onde a contagem é carregada — e o painel precisa
        // CONHECER o campo, senão ele lê `sort=groups:desc` como "N. Prevista" e o
        // "Aplicar filtros" seguinte apaga a ordenação da página.
        showGroupsSort
        showAdultFilter
      />

      <WorkTable
        verdictScale={verdictScale}
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
        // Só num grupo REAL há de onde remover — nas três visões derivadas a ação não existe.
        currentGroup={isPseudo ? undefined : { id: listId, name: listDetail!.name }}
        // A MESMA leitura que ordenou a lista (ver `groupCountByWorkId` nos filtros).
        groupsByWorkId={membership.byWork}
      />
    </div>
  )
}
