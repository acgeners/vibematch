import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import { unstable_cache } from "next/cache"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/work-derived"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { getAllActiveSynopsisPredictions } from "@/server/queries/synopsis-quality"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"

// Tokeniza a busca igual ao filtro antigo do ranking: separa por espaços e
// pontuação para que o padrão "a depois b depois c" atravesse vírgulas/`?`/etc.
// presentes no título mas ausentes na busca.
function searchTokens(search: string): string[] {
  return search
    .replace(/[%_]/g, "")
    .split(/[\s,;:!?·•–—()[\]{}'"`]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

// Verdadeiro quando `name` contém todos os tokens na ordem dada (equivalente ao
// ILIKE `%a%b%c%`). Usado para casar title/original_title/alternative_titles.
function nameMatchesTokens(name: string | null | undefined, tokens: string[]): boolean {
  if (!name) return false
  const haystack = name.toLowerCase()
  let from = 0
  for (const token of tokens) {
    const idx = haystack.indexOf(token, from)
    if (idx === -1) return false
    from = idx + token.length
  }
  return true
}

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
  /**
   * Obra não-lida com baixa cobertura de gênero (predição menos confiável).
   * Enriquecido na página do ranking via getLowCoverageWorkIds — undefined
   * quando não foi computado.
   */
  lowCoverage?: boolean
  /** L1 (single Ridge + decomposição) — a Nota Prevista, âncora do catálogo. */
  expectedScore: number | null
  /** Stage 1 da decomposição — contribuição das features de perfil/tipo. */
  expectedBaseline: number | null
  /** Stage 2 da decomposição — contribuição das 8 quality scores. */
  expectedQualityAdj: number | null
  expectedIsStub: boolean
  /**
   * Nota de Decisão (0–10) — número único de PRIORIDADE ("quão provável que goste").
   * Âncora = Prevista (que já embute o fit calibrado); só a IA Rk. ajusta quando
   * existe (ponderada pela confiança). O fit NÃO entra aqui (evita double-counting)
   * — serve de desempate na exibição. Ver lib/calculations/decision.ts. NULL quando
   * não há Prevista.
   */
  decisionScore: number | null
  /** Chance de gostar (0–100) — Força 1 da Bússola (chance_score calibrado). NULL quando stub/arquivada. */
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
  personalFit: number | null
  /** Percentil 0–100 dentro da biblioteca. NULL quando personalFit é NULL ou pré-migration 071. */
  personalFitPercentile: number | null
  /**
   * lovedTagOverlap − avoidedTagOverlap (perfil EFETIVO: LLM + tags declaradas).
   * Desempate DENTRO do tier (substitui personal_fit nesse papel — auditoria 2026-06:
   * personal_fit ~constante / pior que acaso intra-tier). NULL = perfil sem
   * loved/avoided ou pré-migration 116.
   */
  tagOverlapNet: number | null
  alignmentScore: number | null
  alignmentJustification: string | null
  alignmentAt: string | null
  /** True quando o IA Rk persistido ficou desatualizado (obra editada/re-avaliada). */
  alignmentStale: boolean
  /** Payload enriquecido (sub-fase 2.3.A). NULL pra runs antigas (prompt v1). */
  alignmentPayload: {
    confidence?: number
    risks?: string[]
    similar_loved?: string[]
    similar_avoided?: string[]
    review_quotes?: string[]
    mood_fit?: number
  } | null
  userScore: number | null
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
  /** True quando o Interesse manual foi APLICADO da previsão da IA (synopsis_quality_source = prediction_applied), não definido à mão. */
  synopsisFromPrediction: boolean
  /** Previsão IA de Interesse Sinopse (♥..♥♥♥♥) — synopsis_quality_predictions. NULL se nunca prevista. */
  predictedSynopsisQuality: string | null
  /** True quando a previsão de Interesse Sinopse ficou desatualizada (perfil/sinopse mudou). */
  predictedSynopsisStale: boolean
  /** Confiança 0–1 da previsão de Interesse Sinopse (pra tooltip). */
  predictedSynopsisConfidence: number | null
  observations: string | null
  year: number | null
  updatedAt: string | null
  lastReadAt: string | null
  genres: string[]
  scores: Record<string, number>
  tags: Array<{ id: string; name: string; slug: string; tag_group_id: string | null }>
}

export type RankingSortBy =
  | "expected_score"
  | "decision"
  | "recommended"
  | "platform_avg"
  | "total_votes"
  | "chapters"
  | "chapters_total"
  | "chapters_read"
  | "title"
  | "year"
  | "synopsis_q"
  | "synopsis_pred"
  | "updated_at"
  | "publication_status"
  | "personal_status"
  | "ai_eval_status"
  | "last_read_at"
  | "personal_fit"
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
  /** Previsão IA de Interesse Sinopse (♥..♥♥♥♥) — filtra pelas obras cuja previsão casa. */
  predictedSynopsisQualities?: string[]
  /**
   * Como combinar o filtro de Interesse manual com o de previsão IA quando os
   * DOIS estão ativos: "or" (default — casa qualquer um) ou "and" (casa os dois).
   * Ignorado quando só um dos filtros tem seleção.
   */
  interestMode?: "and" | "or"
  minTotalChapters?: number
  maxTotalChapters?: number
  minYear?: number
  maxYear?: number
  /** Nota Prevista (expected_score, escala 0–10) — filtro headline do novo pipeline. */
  minExpectedScore?: number
  maxExpectedScore?: number
  /** Alinhamento (personal_fit) filtrado pelo PERCENTIL 0–100 (o valor exibido na UI). */
  minPersonalFitPct?: number
  maxPersonalFitPct?: number
  /** IA Rk (alignment_score, 0–100) — re-rank do consultor LLM. */
  minAlignment?: number
  maxAlignment?: number
  minPlatformAvg?: number
  maxPlatformAvg?: number
  minTotalVotes?: number
  maxTotalVotes?: number
  topN?: number
  /** "Só obras com nota" — filtra por Nota Prevista presente (era finalScore). */
  onlyWithFinalScore?: boolean
  onlyFavorites?: boolean
  /** Restringe o resultado a um conjunto explícito de IDs (grupos de favoritos).
   *  Lista vazia => nenhum resultado. Combina (AND) com os demais filtros. */
  onlyWorkIds?: string[]
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
  // Previsões de Interesse Sinopse (tabela pequena) — carregadas em paralelo com
  // o resto. Consumidas ao montar as entries; a previsão é independente dos
  // filtros de works, então não precisa esperar a query principal.
  const synopsisPredictionsPromise = getAllActiveSynopsisPredictions()
  // Sinopse primária (só pro hover preview). Buscar como query achatada separada
  // — apenas (work_id, text) das linhas is_primary, apoiada no índice parcial
  // work_synopses_one_primary — evita embutir TODAS as sinopses (várias por obra,
  // texto completo) no JSON aninhado da query principal (~0.9MB → 0.4MB, dedup).
  const primarySynopsisPromise = supabase
    .from("work_synopses")
    .select("work_id, text")
    .eq("is_primary", true)
    .then(({ data }) => {
      const map = new Map<string, string>()
      for (const r of (data ?? []) as Array<{ work_id: string; text: string | null }>) {
        const t = r.text?.trim()
        if (t) map.set(r.work_id, t)
      }
      return map
    })
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

  // Estado de leitura de QUEM está olhando (Fatia 1). Pro dono, isto é a própria linha de
  // `works` que a query já traz (custo zero). Pros demais, vem de `user_work_state` — e é o
  // que impede a Leitora de ver os favoritos, o status e os capítulos do dono como se fossem
  // dela. Ver server/queries/user-work-state.ts.
  const personal = await getPersonalStateReader()

  // Os filtros pessoais (status de leitura, "só favoritos") não podem sair das colunas de
  // `works` quando quem filtra não é o dono — seriam os favoritos DELE. `null` = dono, filtra
  // no SQL como sempre; array = ids dela (vazio = nenhuma obra casa, e aí o resultado tem que
  // ser vazio de verdade, não "sem filtro").
  const personalFilterIds = await resolvePersonalFilterIds({
    personalStatusIds: personalStatusIdFilter,
    onlyFavorites: filters.onlyFavorites,
  })

  // Interesse ♥ manual (Fatia 2a) — mesma história do status: pra quem não é o dono, `♥♥♥`
  // filtrado na coluna de `works` devolveria as obras que ELE marcou. Vai num set separado
  // (e não junto do de cima) porque este filtro só vale no SQL quando não está no modo OR com
  // a previsão da IA — a condição abaixo é a mesma que já existia.
  const orWithPredActive =
    (filters.interestMode ?? "or") === "or" && !!filters.predictedSynopsisQualities?.length
  const interestFilterIds =
    filters.synopsisQualities?.length && !orWithPredActive
      ? await resolvePersonalFilterIds({ synopsisQualities: filters.synopsisQualities })
      : null

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
    searchIds,
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
    // Resolve a busca por título para IDs. PostgREST não faz ilike sobre text[]
    // (alternative_titles), então a busca DB antiga só cobria title +
    // original_title — um título encontrável apenas pelo alias "não aparecia na
    // busca mas acusava duplicado ao criar". Aqui cobrimos os MESMOS campos da
    // detecção de duplicata (server/actions/works.ts): title + original_title +
    // alternative_titles. Mesma técnica de getSearchMatchIds em
    // server/queries/works.ts; mantém a tokenização atravessa-pontuação.
    filters.search?.trim()
      ? (async (): Promise<string[] | null> => {
          const tokens = searchTokens(filters.search!)
          if (!tokens.length) return null
          const { data, error } = await supabase
            .from("works")
            .select("id, title, original_title, alternative_titles")
            .limit(2000)
          if (error) throw new Error(error.message)
          return (data ?? [])
            .filter(
              (w: {
                title: string | null
                original_title: string | null
                alternative_titles: string[] | null
              }) =>
                nameMatchesTokens(w.title, tokens) ||
                nameMatchesTokens(w.original_title, tokens) ||
                (w.alternative_titles ?? []).some((alt) => nameMatchesTokens(alt, tokens)),
            )
            .map((w: { id: string }) => w.id)
        })()
      : Promise.resolve(null),
    ])

  // Combine include sets via intersection; expand exclude set.
  const includeSets: string[][] = []
  if (genreAllIds) includeSets.push(genreAllIds)
  if (genreAnyIds) includeSets.push(genreAnyIds)
  if (tagAllIds) includeSets.push(tagAllIds)
  if (tagAnyIds) includeSets.push(tagAnyIds)
  // searchIds é null quando não há busca; [] quando a busca não casou nada (a
  // interseção vazia abaixo retorna [] corretamente).
  if (searchIds) includeSets.push(searchIds)
  // Idem pro filtro pessoal de quem NÃO é o dono: [] = ela não tem nenhuma obra nesse status
  // (ou nenhuma favorita) → interseção vazia → resultado vazio. Ignorar a lista vazia aqui
  // devolveria o catálogo inteiro como se fosse tudo dela.
  if (personalFilterIds) includeSets.push(personalFilterIds)
  if (interestFilterIds) includeSets.push(interestFilterIds)
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
      total_chapters, chapters_read, user_score, is_archived, is_favorite,
      synopsis_quality, synopsis_quality_source, canonical_synopsis, observations, year, updated_at, last_read_at,
      calculated_scores(expected_score, expected_baseline, expected_quality_adj, expected_is_stub, chance_score, platform_avg, total_votes, personal_fit, personal_fit_percentile, tag_overlap_net, alignment_score, alignment_justification, alignment_payload, alignment_at, alignment_stale),
      category_scores(criterion_slug, score),
      work_covers(url, is_primary, position)
    `)
  // Nota: work_tags/work_genres NÃO são embutidos aqui. O filtro por gênero/tag
  // já é resolvido em SQL (allowedIds, acima) e nenhum consumidor do RankingEntry
  // lê entry.tags/entry.genres no client — embuti-los só inflava o payload (~3.9MB
  // pra 660 obras). work_synopses idem: vem da query achatada primarySynopsisPromise.

  if (!filters.includeArchived) {
    worksQuery = worksQuery.eq("is_archived", false)
  }

  // A busca por título agora é resolvida para IDs no bloco paralelo acima
  // (searchIds → includeSets), cobrindo também alternative_titles.

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
  // Só o DONO filtra pelas colunas de `works` — pros demais o recorte já veio por id, em
  // `personalFilterIds` (acima). Aplicar este `.in()` pra elas seria filtrar pelo status DELE.
  if (personal.isOwner && personalStatusIdFilter && personalStatusIdFilter.length > 0) {
    worksQuery = worksQuery.in("personal_status_id", personalStatusIdFilter)
  } else if (personalStatusIdFilter && personalStatusIdFilter.length === 0) {
    worksQuery = worksQuery.eq("id", "00000000-0000-0000-0000-000000000000")
  }
  if (filters.aiEvalStatus?.length) {
    worksQuery = worksQuery.in("ai_eval_status", filters.aiEvalStatus)
  }
  // Pré-filtra o Interesse manual no SQL sempre que for seguro. Só NÃO é seguro
  // no modo OR com a previsão IA também ativa: aí os dois viram OR (em memória,
  // abaixo) e este pré-filtro excluiria do fetch as obras que casam só pela
  // previsão. No modo AND (ambos precisam casar) pré-filtrar por manual é válido.
  // Só o DONO filtra pela coluna de `works` — pros demais o recorte já veio por id em
  // `interestFilterIds` (acima).
  if (personal.isOwner && filters.synopsisQualities?.length && !orWithPredActive) {
    worksQuery = worksQuery.in("synopsis_quality", filters.synopsisQualities)
  }
  if (filters.minTotalChapters != null) {
    worksQuery = worksQuery.gte("total_chapters", filters.minTotalChapters)
  }
  if (filters.maxTotalChapters != null) {
    worksQuery = worksQuery.lte("total_chapters", filters.maxTotalChapters)
  }
  if (filters.minYear != null) {
    worksQuery = worksQuery.gte("year", filters.minYear)
  }
  if (filters.maxYear != null) {
    worksQuery = worksQuery.lte("year", filters.maxYear)
  }
  // Idem "só favoritos": pro dono, a coluna de `works` É o favorito dele; pros demais o
  // recorte veio por id em `personalFilterIds`.
  if (filters.onlyFavorites && personal.isOwner) {
    worksQuery = worksQuery.eq("is_favorite", true)
  }
  // Escopo por grupo de favoritos: AND com o allowedIds/exclude acima. Lista
  // vazia => força match vazio (grupo sem obras não deve vazar o catálogo).
  if (filters.onlyWorkIds) {
    if (filters.onlyWorkIds.length === 0) {
      worksQuery = worksQuery.eq("id", "00000000-0000-0000-0000-000000000000")
    } else {
      worksQuery = worksQuery.in("id", filters.onlyWorkIds)
    }
  }

  const { data, error } = await worksQuery.order("title").limit(2000)

  if (error) throw new Error(error.message)

  const synopsisPredictions = await synopsisPredictionsPromise
  const primarySynopses = await primarySynopsisPromise

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
    // Estado de leitura de quem está olhando — NÃO as colunas de `works` (que são as do
    // dono). Pro dono, `get()` devolve exatamente essas colunas; pros demais, as linhas dela.
    const state = personal.get(w.id, w)
    const personalStatusId = state.personalStatusId
    const scores: Record<string, number> = {}
    for (const cs of w.category_scores ?? []) {
      scores[cs.criterion_slug] = cs.score
    }
    const synopsisPred = synopsisPredictions.get(w.id) ?? null

    return {
      rank: 0,
      percentile: 0,
      differentiators: [],
      workId: w.id,
      title: w.title,
      expectedScore: w.calculated_scores?.expected_score ?? null,
      expectedBaseline: w.calculated_scores?.expected_baseline ?? null,
      expectedQualityAdj: w.calculated_scores?.expected_quality_adj ?? null,
      expectedIsStub: w.calculated_scores?.expected_is_stub ?? true,
      decisionScore: computeDecisionScore({
        expected: w.calculated_scores?.expected_score ?? null,
        alignment: w.calculated_scores?.alignment_score ?? null,
        confidence:
          (w.calculated_scores?.alignment_payload as { confidence?: number } | null)?.confidence ??
          null,
      }),
      chanceScore: w.calculated_scores?.chance_score ?? null,
      platformAvg: w.calculated_scores?.platform_avg ?? null,
      totalVotes: w.calculated_scores?.total_votes ?? 0,
      personalFit: w.calculated_scores?.personal_fit ?? null,
      personalFitPercentile: w.calculated_scores?.personal_fit_percentile ?? null,
      tagOverlapNet: w.calculated_scores?.tag_overlap_net ?? null,
      alignmentScore: w.calculated_scores?.alignment_score ?? null,
      alignmentJustification: w.calculated_scores?.alignment_justification ?? null,
      alignmentAt: w.calculated_scores?.alignment_at ?? null,
      alignmentStale: Boolean(w.calculated_scores?.alignment_stale),
      alignmentPayload: w.calculated_scores?.alignment_payload ?? null,
      userScore: state.userScore,
      isFavorite: state.isFavorite,
      publicationStatus: getPublicationStatusNameById(publicationStatusId) ?? "Unknown",
      publicationStatusId,
      publicationStatusShort: publicationStatusDisplay?.short ?? null,
      publicationStatusColor: publicationStatusDisplay?.color ?? null,
      personalStatus: getPersonalStatusNameById(personalStatusId) ?? "Want to Read",
      personalStatusId,
      personalStatusSymbol:
        personalStatusId != null ? personalStatusSymbolsById.get(personalStatusId) ?? null : null,
      aiEvalStatus: w.ai_eval_status,
      totalChapters: w.total_chapters,
      chaptersRead: state.chaptersRead,
      coverUrl: pickPrimaryCover(w.work_covers),
      // Prefere a sinopse CANÔNICA (consolidada via IA) quando existe; cai na
      // primária das fontes enquanto a obra não passou pela consolidação.
      // Mesma regra do getWorkPreview (hover fora do ranking).
      synopsis:
        typeof w.canonical_synopsis === "string" && w.canonical_synopsis.trim()
          ? w.canonical_synopsis.trim()
          : primarySynopses.get(w.id) ?? null,
      synopsisQuality: state.synopsisQuality,
      synopsisFromPrediction: state.synopsisQualitySource === "prediction_applied",
      predictedSynopsisQuality: synopsisPred?.predictedQuality ?? null,
      predictedSynopsisStale: synopsisPred?.stale ?? false,
      predictedSynopsisConfidence: synopsisPred?.confidence ?? null,
      observations: state.observations,
      year: w.year ?? null,
      updatedAt: w.updated_at ?? null,
      lastReadAt: state.lastReadAt,
      // Não embutidos no payload (ver SELECT): o filtro por gênero/tag é feito em
      // SQL e nenhum consumidor lê estes campos no client.
      genres: [],
      scores,
      tags: [],
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
  // Filtros de gênero/tag (genreAll/Any/Exclude, tagSlugsAll/Any/Exclude) já são
  // aplicados em SQL via allowedIds/excludeIds (pre-resolução por pivot, acima).
  // O re-filtro em memória era redundante e exigia carregar tags/genres no payload.
  // Interesse na sinopse (manual) e previsão IA são combinados conforme
  // `interestMode`: "or" (default — a obra entra se casar QUALQUER um dos dois)
  // ou "and" (precisa casar os dois). O modo só importa quando os DOIS estão
  // ativos; com apenas um ativo, equivale ao filtro simples daquele campo em
  // ambos os modos. Os demais filtros seguem AND.
  const wantedSynopsis = filters.synopsisQualities?.length
    ? new Set(filters.synopsisQualities)
    : null
  const wantedSynopsisPred = filters.predictedSynopsisQualities?.length
    ? new Set(filters.predictedSynopsisQualities)
    : null
  if (wantedSynopsis || wantedSynopsisPred) {
    const andMode = (filters.interestMode ?? "or") === "and" && wantedSynopsis != null && wantedSynopsisPred != null
    entries = entries.filter((e) => {
      const manualMatch =
        wantedSynopsis != null && e.synopsisQuality != null && wantedSynopsis.has(e.synopsisQuality)
      const predMatch =
        wantedSynopsisPred != null &&
        e.predictedSynopsisQuality != null &&
        wantedSynopsisPred.has(e.predictedSynopsisQuality)
      return andMode ? manualMatch && predMatch : manualMatch || predMatch
    })
  }
  if (filters.minTotalChapters != null) {
    const min = filters.minTotalChapters
    entries = entries.filter((e) => e.totalChapters != null && e.totalChapters >= min)
  }
  if (filters.maxTotalChapters != null) {
    const max = filters.maxTotalChapters
    entries = entries.filter((e) => e.totalChapters != null && e.totalChapters <= max)
  }
  if (filters.minYear != null) {
    const min = filters.minYear
    entries = entries.filter((e) => e.year != null && e.year >= min)
  }
  if (filters.maxYear != null) {
    const max = filters.maxYear
    entries = entries.filter((e) => e.year != null && e.year <= max)
  }

  // Filtros de notas mínimas (vindos das preferências de ranking)
  if (filters.minExpectedScore != null) {
    const min = filters.minExpectedScore
    entries = entries.filter((e) => e.expectedScore != null && e.expectedScore >= min)
  }
  if (filters.maxExpectedScore != null) {
    const max = filters.maxExpectedScore
    entries = entries.filter((e) => e.expectedScore != null && e.expectedScore <= max)
  }
  // Alinhamento filtrado pelo percentil exibido (fallback: raw × 100, como na célula).
  const fitPct = (e: RankingEntry) =>
    e.personalFitPercentile != null
      ? e.personalFitPercentile
      : e.personalFit != null
        ? e.personalFit * 100
        : null
  if (filters.minPersonalFitPct != null) {
    const min = filters.minPersonalFitPct
    entries = entries.filter((e) => {
      const p = fitPct(e)
      return p != null && p >= min
    })
  }
  if (filters.maxPersonalFitPct != null) {
    const max = filters.maxPersonalFitPct
    entries = entries.filter((e) => {
      const p = fitPct(e)
      return p != null && p <= max
    })
  }
  // Veredito IA (alignment) é calculado sob demanda/pago — a maioria das obras tem
  // alignment_score NULL. Um mínimo/máximo NÃO deve reprovar quem nunca teve o
  // Veredito calculado (senão o filtro esconde catálogos inteiros, ex: Untracked);
  // nulo = "não avaliado por este critério" → passa.
  if (filters.minAlignment != null) {
    const min = filters.minAlignment
    entries = entries.filter((e) => e.alignmentScore == null || e.alignmentScore >= min)
  }
  if (filters.maxAlignment != null) {
    const max = filters.maxAlignment
    entries = entries.filter((e) => e.alignmentScore == null || e.alignmentScore <= max)
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
    entries = entries.filter((e) => e.expectedScore != null)
  }

  // Ordenação
  const levels: SortLevel[] = filters.sortLevels?.length
    ? filters.sortLevels
    : [{ field: filters.sortBy ?? "expected_score", dir: filters.sortDir ?? "desc" }]

  function compareByField(a: RankingEntry, b: RankingEntry, field: string, dir: "asc" | "desc"): number {
    const m = dir === "asc" ? 1 : -1
    const rawScore = (value: number | null | undefined) =>
      value == null ? -Infinity : value
    if (field === "title") return m * a.title.localeCompare(b.title)
    if (field === "expected_score")
      return m * (rawScore(a.expectedScore) - rawScore(b.expectedScore))
    if (field === "decision")
      return m * (rawScore(a.decisionScore) - rawScore(b.decisionScore))
    if (field === "recommended")
      // Unificado com expected_score (auditoria 2026-06): o antigo blend
      // `expected × (0.6 + 0.4·personal_fit)` era ruído — pf é ~constante e ordena
      // pior que o acaso. "Recomendado" (default Free) agora = Nota Prevista,
      // agrupada em tiers e diferenciada DENTRO do tier por tag overlap
      // (reorderTiersByFit no cliente).
      return m * (rawScore(a.expectedScore) - rawScore(b.expectedScore))
    if (field === "platform_avg") return m * (rawScore(a.platformAvg) - rawScore(b.platformAvg))
    if (field === "personal_fit") {
      const av = a.personalFit ?? -Infinity
      const bv = b.personalFit ?? -Infinity
      return m * (av - bv)
    }
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
    if (field === "synopsis_pred")
      return m * ((a.predictedSynopsisQuality?.length ?? 0) - (b.predictedSynopsisQuality?.length ?? 0))
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
