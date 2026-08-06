import { getRanking, type RankingFilters, type RankingSortBy, type SortLevel } from "@/server/queries/ranking"
import { sanitizeInterestSelection } from "@/lib/interest-sentinels"
import { canConsumeAi } from "@/server/queries/current-user"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getCriterionColorRanges } from "@/server/queries/criterion-prefs"
import { getCriterionMomentsSafe } from "@/server/queries/criterion-moments"
import { getHighlightWeightsSafe } from "@/server/queries/score-weights"
import { resolveMoodThresholds } from "@/lib/ranking/criterion-unit"
import { getTierBandWidth } from "@/server/queries/tier-band-width"
import { getLowCoverageWorkIds } from "@/server/queries/calibration-guards"
import { getAllGenres, getGenreCatTypes } from "@/server/queries/genres"
import { getAllTags } from "@/server/queries/tags"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { getStatusOptions } from "@/server/queries/status-options"
import { getFilterPresets } from "@/server/queries/filter-presets"
import { countStaleAlignmentWorks } from "@/server/queries/recommendations"
import { getRecalcPendingState } from "@/server/recalc/queue"
import { Header } from "@/components/layout/header"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { RankingTable } from "@/components/ranking/ranking-table"
import type { ActiveFilterChip } from "@/components/ranking/active-filters-bar"
import { RankingFilters as RankingFiltersComponent } from "@/components/ranking/ranking-filters"
import { tierBandWidthSchema } from "@/lib/ranking/tier-config"
import { SurpriseMeButton } from "@/components/ranking/surprise-me-button"
import { MOOD_PRESETS_BY_ID } from "@/lib/constants/mood-presets"
import { RankingAiMenu } from "@/components/ranking/ranking-ai-menu"
import { FavoritesIconLink } from "@/components/ranking/favorites-icon-link"
import { CRITERION_SLUGS, DEFAULT_CRITERION_SCORE_PRESETS } from "@/types/domain"
import { createAdminClient } from "@/lib/supabase/admin"
import type { FormulaConfig, CriterionScorePresets } from "@/types/domain"
import { unstable_cache } from "next/cache"
import { after } from "next/server"
import { recordRankingSnapshots } from "@/lib/server/predictions/record-prediction"
import { UNREAD_PERSONAL_STATUSES, DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"
import { UNTRACKED_PERSONAL_STATUS } from "@/lib/constants/status-lookups"

interface RankingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const getPreferences = unstable_cache(async (): Promise<{
  topN: number | null
  minFit: number | null
  minAlign: number | null
  minFinal: number | null
  criterionPresets: CriterionScorePresets
  confidenceVotes: number | null
}> => {
  const supabase = createAdminClient()
  // select("*") (não lista de colunas) pra tolerar a coluna criterion_score_presets
  // ainda não existir antes da migration 132 — evita quebrar topN/min-scores nesse
  // intervalo; a coluna ausente só cai no default.
  const { data } = await supabase
    .from("formula_config")
    .select("*")
    .limit(1)
    .single()
  const cfg = data as Pick<
    FormulaConfig,
    "top_n" | "min_calc_score" | "min_predicted_score" | "min_final_score" | "criterion_score_presets" | "pseudo_votes_nota_m"
  > | null
  return {
    topN: cfg?.top_n ?? null,
    // Confiança do público (pseudo-votos bayesianos): acima desse nº de votos a
    // média externa pesa ≥ 50% na Nota Prevista. Vira o limiar "confiável" do
    // filtro de Votos externos (era um card passivo em /settings).
    confidenceVotes: cfg?.pseudo_votes_nota_m ?? null,
    // Colunas legadas repurposadas como filtros padrão (ver ranking-preferences-form):
    // min_calc_score → Alinhamento, min_predicted_score → Veredito IA, min_final_score → Nota Prevista.
    minFit: cfg?.min_calc_score ?? null,
    minAlign: cfg?.min_predicted_score ?? null,
    minFinal: cfg?.min_final_score ?? null,
    // Atalhos ≥ da aba Notas (migration 132). Null/ausente → default hardcoded.
    criterionPresets: cfg?.criterion_score_presets ?? DEFAULT_CRITERION_SCORE_PRESETS,
  }
}, ["ranking-preferences"], { revalidate: 300, tags: ["ranking-preferences"] })

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

  // ⚠️ Os limiares por critério na URL estão SEMPRE em pontos (0–10). A unidade σ
  // do /ranking é uma lente de EXIBIÇÃO (?crit_unit=sd) e não muda o que a URL
  // carrega — de propósito: a mesma query string é lida por `getRanking`, pelos
  // presets salvos e pelo `parseFiltersFromSearchParams` do diálogo de
  // recomendação. Guardar σ aqui fazia `min_romance=-0.5` virar "≥ −0,5 PONTOS"
  // naquele último, ou seja, filtro nenhum, sem erro e com resultado.
  const moodId = str("mood")
  const moodPreset = moodId ? MOOD_PRESETS_BY_ID[moodId] : null
  // Dispara já, sem await: só entra no caminho crítico quando há mood ativo (que
  // guarda os limiares em σ e precisa convertê-los agora). Fora disso é aguardada
  // no Promise.all lá embaixo, porque a UI precisa dos momentos pra exibir a lente.
  const momentsPromise = getCriterionMomentsSafe()
  const needsMoments = Boolean(moodPreset?.criterionMinSd || moodPreset?.criterionMaxSd)
  const moments = needsMoments ? await momentsPromise : null

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
  //
  // Os limiares do preset vivem em σ e são convertidos aqui com os momentos de
  // HOJE: é isso que impede a calibração de apodrecer sozinha conforme o
  // catálogo cresce (era como "Romance" tinha virado 55% do acervo). Quando os
  // momentos não vêm, cada atributo cai no seu valor em pontos.
  if (moodPreset) {
    const mood = resolveMoodThresholds(moodPreset, moments)
    for (const [slug, value] of Object.entries(mood.min)) {
      if (value != null) criterionMin[slug] = value
    }
    for (const [slug, value] of Object.entries(mood.max)) {
      if (value != null) criterionMax[slug] = value
    }
  }

  // Whitelist espelha `RankingSortBy` em server/queries/ranking.ts.
  // Sem o expected_*, sort por "Esperada" caía silenciosamente em final_score.
  const validSortFields = new Set<string>([
    // Notas (novo pipeline)
    "decision", "recommended",
    "expected_score", "expected_baseline", "expected_quality_adj", "personal_fit",
    "alignment_score",
    // Plataforma
    "platform_avg", "total_votes",
    // Metadata
    "title", "year", "synopsis_q", "synopsis_pred",
    "chapters", "chapters_total", "chapters_read",
    "publication_status", "personal_status", "ai_eval_status",
    "updated_at", "last_read_at",
    // Critérios IA
    ...CRITERION_SLUGS.map((s) => `crit_${s}`),
  ])
  // Default: ordena pela Nota Prevista e, como desempate, Veredito IA no plano Pago
  // (NULL no Free) ou Alinhamento no Free. Os empates só quebram no EXATO no
  // SQL; o desempate band-aware fino é client-side.
  // `plan` (canAi) é buscado no Promise.all do trio abaixo (junto de prefs/declaredPrefs)
  // pra não pagar um round-trip serial só dele.
  // Filtro opt-in "esconder minhas tags evitadas", em 3 estados:
  //   off | "strong" (só as evitadas com ênfase 2×) | "all" (todas as evitadas).
  // Só busca as declarações quando ligado (custo zero quando off). O efeito SUAVE
  // do evito (deprioriza via personal_fit) vale sempre, sem este toggle.
  const hideMode = str("hide_avoided") // "strong" | "all" | undefined
  const hideActive = hideMode === "strong" || hideMode === "all"
  // Só estas três alimentam `filters` (canAi → sort/plano, prefs → mínimos/topN,
  // declaredPrefs → tags evitadas). O getRanking (a query pesada, ~90% do tempo da página)
  // depende SÓ delas — então só elas o bloqueiam. Os metadados do painel (gêneros, tags,
  // status, presets) e as queries independentes da lista descem pro Promise.all de baixo,
  // pra rodarem em PARALELO com o getRanking em vez de na frente dele.
  const [canAi, prefs, declaredPrefs] = await Promise.all([
    canConsumeAi(),
    getPreferences(),
    hideActive ? getDeclaredTagPreferences() : Promise.resolve([]),
  ])
  const avoided = declaredPrefs.filter((p) => p.stance === "avoid")
  const avoidedSlugs =
    hideMode === "all"
      ? avoided.map((p) => p.slug)
      : hideMode === "strong"
        ? avoided.filter((p) => p.weight >= 2).map((p) => p.slug)
        : []
  const isPaid = canAi
  const defaultSort = isPaid
    ? "expected_score:desc,alignment_score:desc"
    : "expected_score:desc,personal_fit:desc"
  const rawSort = str("sort") ?? defaultSort
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
        : [...UNREAD_PERSONAL_STATUSES]

  const pubStatusParam = str("pub_status")
  const publicationStatus =
    pubStatusParam === "all"
      ? undefined
      : pubStatusParam
        ? pubStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Completed"]

  // URL pode sobrescrever as preferências (ex: usuário ajusta direto na barra).
  // A preferência "Nota Prevista mínima" é persistida em min_final_score (repurposada).
  // top_n ≤ 0 (estado degenerado "mostrar todas" que grudava na URL) é tratado como
  // ausente → cai no default do formula_config (40). O input tem min=1, então 0 nunca
  // é entrada válida; normalizar aqui evita a página carregar presa em 0.
  const rawTopN = num("top_n")
  const overrideTopN = rawTopN != null && rawTopN > 0 ? rawTopN : undefined
  const overrideMinExpected = num("min_expected")
  // "Só avaliadas" (?rated=1): filtra pras obras com nota pessoal (as que treinaram
  // o modelo) e mostra as finalizadas. Os OUTROS defaults de "lista de leitura"
  // (status, mínimos de nota) são neutralizados pela PRÓPRIA URL do CTA
  // (pub_status=all, per_status=all, min_expected=0) — assim cliente e servidor
  // ficam consistentes, sem lógica de supressão escondida no servidor.
  const onlyRated = str("rated") === "1"

  // Filtro de conteúdo 18+ por-ranking (?adult=hide|only). Usa works.is_adult (a
  // mesma fonte do chip da obra), não tags. Ausente = respeita a preferência global.
  const adultParam = str("adult")
  const adultFilter = adultParam === "hide" || adultParam === "only" ? adultParam : undefined

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
    minExpectedScore: overrideMinExpected ?? prefs.minFinal ?? undefined,
    maxExpectedScore: num("max_expected"),
    minPersonalFitPct: num("min_fit") ?? prefs.minFit ?? undefined,
    maxPersonalFitPct: num("max_fit"),
    minAlignment: num("min_align") ?? prefs.minAlign ?? undefined,
    maxAlignment: num("max_align"),
    minPlatformAvg: num("min_platform_avg"),
    maxPlatformAvg: num("max_platform_avg"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    topN: overrideTopN ?? prefs.topN ?? undefined,
    onlyWithFinalScore: str("only_scored") === "1",
    onlyWithoutFinalScore: str("no_score") === "1",
    onlyFavorites: str("fav") === "1",
    onlyRated,
    adultFilter,
    sortLevels,
  }

  // getRanking (a query pesada) roda em paralelo com TUDO que não alimenta `filters`: os
  // metadados do painel (gêneros/tags/status/presets) e as queries independentes da lista.
  // Um único Promise.all mantém os handlers de rejeição anexados (nada de promise solta que
  // vira unhandledRejection se o getRanking estourar antes de ser aguardado).
  const [
    rawEntries,
    allGenres, genreCatTypes, allTags, statusOptions, savedPresets,
    scoreThresholds, tierBandWidth, lowCoverageIds, staleAlignmentCount, recalcState, criterionPrefs,
    criterionMoments, highlightWeights,
  ] = await Promise.all([
    getRanking(filters),
    getAllGenres(),
    getGenreCatTypes(),
    getAllTags(),
    getStatusOptions(),
    getFilterPresets("/ranking"),
    getScoreColorThresholds(),
    getTierBandWidth(),
    getLowCoverageWorkIds(),
    countStaleAlignmentWorks(),
    getRecalcPendingState(),
    getCriterionColorRanges(),
    momentsPromise,
    getHighlightWeightsSafe(),
  ])
  // Marca obras não-lidas com baixa cobertura de gênero (badge ⚠ na Nota esperada).
  const entries = rawEntries.map((e) => ({ ...e, lowCoverage: lowCoverageIds.has(e.workId) }))

  // ── Instrumentação prospectiva (AUDIT_REPORT-2026-07-08, P1) ──
  // Registra um snapshot IMUTÁVEL da ordem exibida (só obras prospectivas, sem
  // user_score) pra medir o ranking contra baselines quando as notas chegarem.
  // Best-effort via `after()`: roda DEPOIS da resposta, nunca bloqueia o render,
  // e é no-op silencioso enquanto a migration 105/135 não estiver aplicada. O
  // ranking_snapshot_id é determinístico por (dia, filtros, mood) → dedup evita
  // escrita repetida. NÃO altera nenhum score.
  after(() =>
    recordRankingSnapshots({
      orderedWorkIds: entries.map((e) => e.workId),
      filtersKey: JSON.stringify(filters),
      moodKey: moodId ?? null,
    }),
  )

  // Override de TESTE da largura das bandas via ?band= (não persiste). Inválido →
  // cai no valor salvo em formula_config.tier_band_width.
  const bandParam = num("band")
  const bandParse = bandParam != null ? tierBandWidthSchema.safeParse(bandParam) : null
  const effectiveTierBandWidth = bandParse?.success ? bandParse.data : tierBandWidth

  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((v) => queryParams.append(key, v))
      } else {
        queryParams.set(key, value)
      }
    }
  }
  const queryString = queryParams.toString()
  const favoritesUrl = `/favorites${queryString ? `?${queryString}` : ""}`

  // ── Chips de filtros ativos (só a view "Faixas" consome) ──
  // Puramente descritivo + navegação por URL usando os parâmetros JÁ suportados
  // (pub_status/per_status/min_expected/top_n). NÃO altera getRanking, ordenação,
  // score ou dados — apenas torna visíveis os filtros aplicados por padrão.
  const baseFilterParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value
    if (v != null) baseFilterParams.set(key, v)
  }
  const filterHref = (mutate: (p: URLSearchParams) => void): string => {
    const p = new URLSearchParams(baseFilterParams.toString())
    mutate(p)
    const s = p.toString()
    return `/ranking${s ? `?${s}` : ""}`
  }
  // Rótulos dos chips do filtro padrão. As CHAVES são computadas do banco — escrevê-las à mão
  // faria o chip sumir em silêncio no dia em que o status fosse renomeado (o filtro continuaria
  // ativo, mas sem rótulo pra removê-lo).
  const PERSONAL_STATUS_LABELS: Record<string, string> = {
    [DEFAULT_PERSONAL_STATUS]: "Lista: Quero ler",
    [UNTRACKED_PERSONAL_STATUS]: "Inclui: Sem status",
  }
  const activeFilterChips: ActiveFilterChip[] = []
  if (publicationStatus?.length) {
    activeFilterChips.push({
      key: "pub",
      label: `Publicação: ${publicationStatus.join(", ")}`,
      isDefault: pubStatusParam == null,
      removeHref: filterHref((p) => p.set("pub_status", "all")),
    })
  }
  if (personalStatus?.length) {
    for (const st of personalStatus) {
      const others = personalStatus.filter((s) => s !== st)
      activeFilterChips.push({
        key: `per-${st}`,
        label: PERSONAL_STATUS_LABELS[st] ?? `Lista: ${st}`,
        isDefault: perStatusParam == null,
        removeHref: filterHref((p) =>
          others.length ? p.set("per_status", others.join(",")) : p.set("per_status", "all"),
        ),
      })
    }
  }
  if (filters.minExpectedScore != null && filters.minExpectedScore > 0) {
    activeFilterChips.push({
      key: "min-expected",
      label: `Nota estimada ≥ ${String(filters.minExpectedScore).replace(".", ",")}`,
      isDefault: overrideMinExpected == null,
      removeHref: filterHref((p) => p.set("min_expected", "0")),
    })
  }
  if (filters.topN != null) {
    activeFilterChips.push({
      key: "top-n",
      label: `Top ${filters.topN} resultados`,
      isDefault: overrideTopN == null,
      removeHref: filterHref((p) => p.set("top_n", "9999")),
    })
  }
  if (filters.onlyRated) {
    activeFilterChips.push({
      key: "rated",
      label: "Só avaliadas",
      isDefault: false,
      removeHref: filterHref((p) => p.delete("rated")),
    })
  }
  const clearFiltersHref = filterHref((p) => {
    p.set("pub_status", "all")
    p.set("per_status", "all")
    p.set("min_expected", "0")
    p.set("top_n", "9999")
    p.delete("rated")
  })

  return (
    <div className="space-y-4">
      <Header
        kicker="Ranking"
        title={
          <span className="inline-flex items-center gap-3">
            Ranking
            <RecalcPendingControl pending={recalcState.pending} variant="indicator" />
          </span>
        }
        description="Obras ordenadas pela Nota Prevista"
        actions={
          <div className="flex items-center gap-2">
            <FavoritesIconLink href={favoritesUrl} />
            <SurpriseMeButton entries={entries} iconOnly />
            <RankingAiMenu isPaid={isPaid} staleAlignmentCount={staleAlignmentCount} />
          </div>
        }
      />

      <RankingFiltersComponent
        availableGenres={allGenres}
        genreCatTypes={genreCatTypes}
        showHideAvoided
        availableTags={allTags}
        publicationStatuses={statusOptions.publicationStatuses}
        personalStatuses={statusOptions.personalStatuses}
        defaultTopN={prefs.topN}
        defaultSort={defaultSort}
        savedPresets={savedPresets}
        defaultBand={tierBandWidth}
        criterionPresets={prefs.criterionPresets}
        confidenceVotes={prefs.confidenceVotes}
        criterionMoments={criterionMoments}
        showAdultFilter
      />

      <RankingTable entries={entries} scoreThresholds={scoreThresholds} defaultSort={defaultSort} isPaid={isPaid} tierBandWidth={effectiveTierBandWidth} criterionPrefs={criterionPrefs} activeFilters={activeFilterChips} clearFiltersHref={clearFiltersHref} criterionMoments={criterionMoments} highlightWeights={highlightWeights} />
    </div>
  )
}
