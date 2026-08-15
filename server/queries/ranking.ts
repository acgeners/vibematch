import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import { unstable_cache } from "next/cache"
import {
  getPublicationStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/work-derived"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { getAllActiveSynopsisPredictions } from "@/server/queries/synopsis-quality"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { getHideAdultContent } from "@/server/queries/current-user"
import { selectByIdsInChunks, fetchAllRows } from "@/lib/supabase/paginate"
import { titleTokens, workMatchesQuery } from "@/lib/title-match"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { compareWithinTierTieBreak } from "@/lib/ranking/build-tiers"
import { artBandFromPercentile, type ArtBand } from "@/lib/arte/model"
import { artFilterMatches } from "@/lib/arte/url"
import { INTEREST_NONE, matchesManualInterest, matchesPredictedInterest } from "@/lib/interest-sentinels"
import { isTerminalPersonalStatus } from "@/lib/constants/status-lookups"
import { personalStatusNameOrDefault } from "@/lib/constants/status-lookups"

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
  /**
   * Posição da estimativa de arte no catálogo (0–1). É esta a grandeza que ordena e filtra —
   * a estimativa em PONTOS não vem no select de propósito: ela é comprimida a ~0,49× a escala
   * do rótulo, e um limiar em pontos devolve 56% do catálogo onde a taxa real é 75%. Não
   * trazer o valor cru é o que impede alguém de exibi-lo como se fosse nota.
   *
   * NULL = sem estimativa (obra sem sinal de arte, modelo abaixo do piso, ou quem está olhando
   * não é o dono). Terceiro estado, nunca "média".
   */
  artPercentile: number | null
  /** Faixa derivada do percentil (20/60/20). NULL quando não há estimativa. */
  artBand: ArtBand | null
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
  /** Conteúdo adulto (18+) efetivo — works.is_adult (COALESCE(adult_override, adult_auto)). */
  isAdult: boolean
  publicationStatus: string
  publicationStatusId: number | null
  publicationStatusShort: string | null
  publicationStatusColor: string | null
  /** Qualifica o hiato (migration 183) — o glifo »/— do badge sai daqui. */
  hiatusKind: HiatusKind | null
  hiatusKindConfidence: "high" | "low" | null
  /** Texto cru do MangaUpdates; é a prova que o tooltip do badge mostra. */
  publicationStatusNote: string | null
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
  | "user_score"
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
  | "art"
  /** Recorrência nos grupos de favoritos — exige `groupCountByWorkId` nos filtros. */
  | "groups"
  | `crit_${string}`

export interface SortLevel {
  field: RankingSortBy
  dir: "asc" | "desc"
}

export interface RankingFilters {
  search?: string
  includeArchived?: boolean
  /**
   * Ignora a preferência "ocultar 18+" do usuário e traz obras adultas mesmo assim.
   * Só pra views de CURADORIA/AUDITORIA (que precisam ver tudo). Sem isto, `getRanking`
   * respeita `hide_adult_content` e esconde `is_adult` das listas de quem optou por ocultar.
   */
  includeAdult?: boolean
  /**
   * Filtro de conteúdo adulto (18+) POR-RANKING, controlado na UI (?adult=). Usa
   * `works.is_adult` — a mesma fonte do chip 🔞 da obra, independente de tags.
   * - "hide": esconde obras is_adult mesmo que a preferência global as mostre.
   * - "only": mostra SÓ obras is_adult e IGNORA a preferência global de ocultar
   *   (senão o `hideAdult=true` cairia em is_adult=false e zeraria o resultado).
   * - undefined: respeita a preferência global (getHideAdultContent).
   * Ortogonal a `includeAdult` (opt-out interno de curadoria/auditoria).
   */
  adultFilter?: "hide" | "only"
  /**
   * Limiares dos 9 atributos, em PONTOS (0–10) — e só.
   *
   * O /ranking tem uma unidade σ (`?crit_unit=sd`), mas ela é lente de
   * EXIBIÇÃO: a query string continua carregando pontos, e esta query nunca vê
   * σ. Quem converte é a UI, na hora de mostrar e de gravar. Ver
   * lib/ranking/criterion-unit.ts e o teste de invariante em
   * tests/unit/orchestration/criterion-unit-url-invariant.test.ts.
   */
  criterionMin?: Partial<Record<string, number>>
  criterionMax?: Partial<Record<string, number>>
  publicationStatus?: string[]
  personalStatus?: string[]
  /**
   * Exclusão de status (`not in`), o par do positivo acima. Os dois NUNCA vêm juntos —
   * `readStatusFilter` (lib/status-filter-toggle.ts) é o dono da regra, e num conjunto
   * fechado eles são redundantes. A diferença que importa é o FUTURO: a lista positiva
   * ignora um status que entre depois na tabela; a exclusão o adota.
   */
  publicationStatusExclude?: string[]
  personalStatusExclude?: string[]
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
  /** O inverso: só as obras SEM Nota Prevista (fila de "o que falta enriquecer").
   *  Ligar os dois ao mesmo tempo devolve vazio — a UI os torna mutuamente
   *  exclusivos, mas a query não presume isso. */
  onlyWithoutFinalScore?: boolean
  /** "Só avaliadas" — obras com nota pessoal (user_score). Como avaliar costuma
   *  implicar ter terminado a obra, ligar isto também DESLIGA o hard filter que
   *  esconde Finished/Dropped — senão o filtro esconderia justamente o que quer
   *  mostrar (ex.: "as obras avaliadas que puxam o peso de um critério"). */
  onlyRated?: boolean
  onlyFavorites?: boolean
  /** Restringe o resultado a um conjunto explícito de IDs (grupos de favoritos).
   *  Lista vazia => nenhum resultado. Combina (AND) com os demais filtros. */
  onlyWorkIds?: string[]
  /** Quando true, não aplica o hard filter que esconde obras Completed/Dropped.
   *  Default false (mantém semântica de "ranking de o que ler"). Páginas tipo
   *  /titles e /favorites devem passar true. */
  includeFinishedDropped?: boolean
  /**
   * Filtro por ESTIMATIVA DE ARTE (?art=). Nunca em pontos — a estimativa é comprimida a
   * ~0,49x a escala do rótulo, e um limiar em pontos devolve 56% do catálogo onde a taxa real
   * é 75%. Por isso o valor é a FAIXA (percentil 20/60/20), e por isso não usa a família
   * `min_<slug>`/`max_<slug>`, que é contrato em pontos dos 9 atributos.
   *
   * 🔴 Os dois tratam "sem estimativa" de forma OPOSTA, e é de propósito:
   * - "forte": só a faixa de cima. Obra sem estimativa NÃO passa — ninguém apurou que ela é
   *   forte, e um filtro positivo que aceita desconhecido devolve o que não foi pedido.
   * - "sem_fraca": esconde só a faixa de baixo. Obra sem estimativa PASSA — esconder o que
   *   nunca foi medido apagaria 2,4% do catálogo em silêncio (e 100% antes da semente).
   */
  artFilter?: "forte" | "sem_fraca"
  /**
   * Em quantos grupos de favoritos cada obra está — só para poder ORDENAR por isso
   * (`sortLevels: [{ field: "groups" }]`). Não filtra nada.
   *
   * Vem de fora porque é dado de OUTRA tabela (`work_list_items`) e per-usuário: o
   * `getRanking` serve /titles e /ranking também, e ali ninguém paga essa leitura. Ausente,
   * a contagem é 0 para todos e ordenar por "groups" não muda nada — o que é o correto,
   * já que nessas telas a coluna nem é oferecida.
   *
   * 🔴 Quem monta este Record tem que ser a MESMA leitura que alimenta a célula da tabela
   * (`groupCountsFrom(membership)`), senão a lista ordena por um número e mostra outro.
   */
  groupCountByWorkId?: Record<string, number>
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
  const publicationStatusExcludeIds = resolveStatusIds(
    filters.publicationStatusExclude,
    getPublicationStatusIdByName
  )
  // "Unknown" é o nome que a entry usa para `publication_status_id` NULO (ver o
  // `?? "Unknown"` lá embaixo) E é também um status real da tabela. Excluir "Unknown"
  // portanto precisa alcançar os dois — e é o que decide o tratamento do NULL no SQL.
  const excludesUnknownPublication = Boolean(filters.publicationStatusExclude?.includes("Unknown"))

  // Estado de leitura de QUEM está olhando (Fatia 1). Pro dono, isto é a própria linha de
  // `works` que a query já traz (custo zero). Pros demais, vem de `user_work_state` — e é o
  // que impede a Leitora de ver os favoritos, o status e os capítulos do dono como se fossem
  // dela. Ver server/queries/user-work-state.ts.
  //
  // ⚡ DISPARADO aqui, AGUARDADO só antes do .map() (bem abaixo). Carregar as ~882 linhas do
  // espelho custa ~800ms, e a query principal de `works` NÃO usa este dado — `personal.get()`
  // só é chamado ao MONTAR as entries, depois que a query volta. Aguardar aqui empilhava os
  // dois round-trips em série (~800ms + ~500ms); disparar deixa a query pesada correr em
  // paralelo com o carregamento do estado. Mesmo padrão das promises de sinopse acima.
  const personalPromise = getPersonalStateReader()

  // Preferência "ocultar 18+" (per-usuário). Disparada aqui, aguardada só antes de
  // montar a query pesada — não serializa. `includeAdult` (curadoria/auditoria)
  // curto-circuita: essas views precisam ver as obras adultas.
  const hideAdultPromise = filters.includeAdult
    ? Promise.resolve(false)
    : getHideAdultContent()

  // Os scores DERIVADOS também são de quem olha (Fatia 2b). Pro dono, `calculated_scores` já é
  // a linha dele (custo zero). Pros demais, a Nota Prevista/Chance/Alinhamento saem das linhas
  // DELES — e, sem modelo, saem NULL: o que sobra é a nota da comunidade, que é um fato.
  // Idem: disparado aqui, aguardado antes do .map() (só usado em overlay/hasModel, pós-query).
  const scoresReaderPromise = getScoresReader()

  // Os filtros pessoais saem de `user_work_state` — pra TODO MUNDO, o dono inclusive. As
  // colunas de `works` não filtram mais nada (Fase D). `null` = o caller não pediu filtro
  // pessoal; array vazio = nenhuma obra casa, e aí o resultado tem que ser vazio DE VERDADE,
  // não "sem filtro" (ignorar vazaria o catálogo inteiro como se fosse tudo favorito dela).
  //
  // 🔴 STATUS não entra aqui — de propósito. Uma obra SEM linha de estado **é** "Want to Read"
  // (é o default que o mapeamento abaixo usa: `getPersonalStatusNameById(null) ?? "Want to
  // Read"`), e uma lista de ids só consegue dizer quem TEM linha. Como o /ranking filtra por
  // ["Want to Read", "Untracked"] POR PADRÃO, filtrar status por id fazia a Leitora (zero
  // linhas) abrir um catálogo de 882 obras e ler "Nenhuma obra encontrada". Não deu erro — deu
  // vazio, que é pior. O status é filtrado EM MEMÓRIA, lá embaixo, sobre `entry.personalStatus`
  // (que já carrega o default). Favorito e ♥ podem sair por id: sem linha = não é favorito e
  // não tem ♥, e aí a lista de ids diz a verdade inteira.
  const personalFilterIds = await resolvePersonalFilterIds({
    onlyFavorites: filters.onlyFavorites,
  })

  // Interesse ♥ manual (Fatia 2a). Vai num set separado (e não junto do de cima) porque só
  // vale como recorte quando NÃO está no modo OR com a previsão da IA — senão excluiria do
  // fetch as obras que casam só pela previsão. A condição é a mesma que já existia.
  const orWithPredActive =
    (filters.interestMode ?? "or") === "or" && !!filters.predictedSynopsisQualities?.length
  // 🔴 As sentinelas do chip "Outros" (none/unknown) NÃO podem passar por aqui. A
  // pré-resolução vira `.in("synopsis_quality", [...])` sobre `user_work_state`: uma
  // obra "não avaliada" ou nem tem linha, ou tem `synopsis_quality` NULL — em ambos os
  // casos ela ficaria de fora do fetch, e o filtro devolveria vazio justamente para o
  // valor pedido. Com sentinela, quem recorta é o filtro em memória (mais abaixo).
  const interestHasSentinel = !!filters.synopsisQualities?.includes(INTEREST_NONE)
  const interestFilterIds =
    filters.synopsisQualities?.length && !orWithPredActive && !interestHasSentinel
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
    // busca mas acusava duplicado ao criar". Cobrimos os MESMOS campos da detecção
    // de duplicata (server/actions/works.ts) e, desde lib/title-match.ts, com a
    // MESMA normalização — divergir aqui era um bug mudo (a busca "funcionava", só
    // devolvia menos).
    filters.search?.trim()
      ? (async (): Promise<string[] | null> => {
          const tokens = titleTokens(filters.search)
          if (!tokens.length) return null
          // Pagina: `.limit(2000)` mentia se o PostgREST cortasse em 1000, e a
          // busca voltaria silenciosamente incompleta.
          const rows = await fetchAllRows<{
            id: string
            title: string | null
            original_title: string | null
            alternative_titles: string[] | null
          }>(
            (from, to) =>
              supabase
                .from("works")
                .select("id, title, original_title, alternative_titles")
                .range(from, to),
            "getRanking:search",
          )
          return rows.filter((w) => workMatchesQuery(w, tokens)).map((w) => w.id)
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

  // ⚠️ NENHUMA coluna pessoal aqui (Fase D). Status, capítulos, nota, ♥, favorito, anotações e
  // "última leitura" vêm de `personal.get()` — a linha de QUEM OLHA. Trazê-las de `works` era
  // trazer as do dono e depois sobrescrevê-las; o que sobrava era um select que só existia
  // para o `DROP COLUMN` tropeçar nele.
  // Restrição POSITIVA por id — allowedIds (gênero/tag/busca/♥) ∩ onlyWorkIds (grupo de
  // favoritos) — resolvida em MEMÓRIA, não com dois `.in("id", ...)` encadeados.
  //
  // ⚠️ Empurrar centenas de ids num único `.in("id", ...)` JUNTO dos embeds
  // (calculated_scores/category_scores/work_covers) faz o planner do Postgres despencar num
  // nested-loop: medido, a mesma query passa de ~0,1s (≤300 ids) para ~8s acima disso — o
  // gateway do Supabase derruba a conexão e o Node reporta `TypeError: fetch failed` (era o
  // bug do /ranking com o filtro de ♥, que resolve pra 385 ids). A in-list OU os embeds,
  // sozinhos, são baratos; é a COMBINAÇÃO que explode. Por isso o filtro por id sai em LOTES
  // (selectByIdsInChunks, 100/lote): cada lote é uma query curta — e ainda mantém a URL longe
  // do teto de ~24KB do gateway. As linhas são reordenadas em memória mais abaixo, então a
  // ordem por lote não importa.
  let restrictIds: string[] | null = allowedIds
  if (filters.onlyWorkIds) {
    // Lista vazia => grupo sem obras não deve vazar o catálogo.
    if (filters.onlyWorkIds.length === 0) return []
    const wanted = new Set(filters.onlyWorkIds)
    restrictIds = restrictIds ? restrictIds.filter((id) => wanted.has(id)) : filters.onlyWorkIds
  }
  if (restrictIds && restrictIds.length === 0) return []

  // Todos os filtros ESCALARES (mais o exclude por not-in) numa fábrica, pra reaplicá-los
  // idênticos a cada lote de ids. Nota: work_tags/work_genres NÃO são embutidos — o filtro por
  // gênero/tag já virou id em `allowedIds` e nenhum consumidor lê entry.tags/genres no client
  // (embuti-los inflava o payload ~3.9MB). work_synopses idem: vem de primarySynopsisPromise.
  const hideAdult = await hideAdultPromise

  const buildWorksQuery = () => {
    let q = supabase
      .from("works")
      .select(`
        id, title, publication_status_id, ai_eval_status,
        hiatus_kind, hiatus_kind_confidence, publication_status_note,
        total_chapters, is_archived, is_adult,
        canonical_synopsis, year, updated_at,
        calculated_scores(expected_score, expected_baseline, expected_quality_adj, expected_is_stub, chance_score, platform_avg, total_votes, personal_fit, personal_fit_percentile, tag_overlap_net, art_percentile, alignment_score, alignment_justification, alignment_payload, alignment_at, alignment_stale),
        category_scores(criterion_slug, score),
        work_covers(url, is_primary, position)
      `)
    if (!filters.includeArchived) q = q.eq("is_archived", false)
    // Conteúdo 18+ (works.is_adult). O filtro POR-RANKING (?adult=) tem prioridade
    // sobre a preferência global:
    //   "only" → só adultas; ignora `hideAdult` de propósito (senão is_adult=false
    //            do hideAdult conflitaria com is_adult=true e zeraria o resultado).
    //   "hide" → esconde adultas explicitamente, mesmo se a pessoa costuma vê-las.
    //   ausente → cai na Fase 2 do 18+: quem optou por ocultar (hideAdult) não vê
    //            adultas nas listas. Cobre ranking, catálogo, favoritos e o pool de
    //            recomendações — todos passam por aqui.
    if (filters.adultFilter === "only") q = q.eq("is_adult", true)
    else if (filters.adultFilter === "hide") q = q.eq("is_adult", false)
    else if (hideAdult) q = q.eq("is_adult", false)
    // Exclude por not-in só quando NÃO há restrição positiva por allowedIds — senão o exclude
    // já foi removido de allowedIds acima. (Baseado em `allowedIds`, não `restrictIds`: com
    // onlyWorkIds sozinho o exclude ainda precisa valer.)
    if (!allowedIds && excludeIds.size > 0) {
      q = q.not("id", "in", `(${[...excludeIds].join(",")})`)
    }
    if (publicationStatusIdFilter && publicationStatusIdFilter.length > 0) {
      q = q.in("publication_status_id", publicationStatusIdFilter)
    } else if (publicationStatusIdFilter && publicationStatusIdFilter.length === 0) {
      // Filter pediu status que nenhum nome resolve — força match vazio.
      q = q.eq("id", "00000000-0000-0000-0000-000000000000")
    }
    // Exclusão de status de publicação. 🔴 `not in` NÃO casa linha com a coluna NULA
    // (NULL não é comparável), e essa obra aparece na UI como "Unknown" — deixar o
    // `not in` sozinho a faria sumir ao excluir QUALQUER outro status, em silêncio e
    // discordando do filtro em memória logo abaixo. Hoje são 0 obras nessa situação
    // (medido no clone local), mas a coluna é nullable e o `?? "Unknown"` existe por
    // isso. Quando "Unknown" É um dos excluídos, o comportamento cru do `not in` já é
    // o desejado: a linha nula também sai.
    if (publicationStatusExcludeIds && publicationStatusExcludeIds.length > 0) {
      const ids = `(${publicationStatusExcludeIds.join(",")})`
      q = excludesUnknownPublication
        ? q.not("publication_status_id", "in", ids)
        : q.or(`publication_status_id.is.null,publication_status_id.not.in.${ids}`)
    }
    // O STATUS de leitura NÃO é filtrado em SQL — nem pro dono. Ele sai em memória, sobre
    // `entry.personalStatus`, porque só lá a obra sem linha de estado aparece como
    // "Want to Read" (ver o comentário no topo, em `personalFilterIds`).
    if (filters.aiEvalStatus?.length) q = q.in("ai_eval_status", filters.aiEvalStatus)
    if (filters.minTotalChapters != null) q = q.gte("total_chapters", filters.minTotalChapters)
    if (filters.maxTotalChapters != null) q = q.lte("total_chapters", filters.maxTotalChapters)
    if (filters.minYear != null) q = q.gte("year", filters.minYear)
    if (filters.maxYear != null) q = q.lte("year", filters.maxYear)
    return q
  }

  const { data, error } = restrictIds
    ? await selectByIdsInChunks(restrictIds, (chunk) =>
        buildWorksQuery().in("id", chunk).limit(2000),
      )
    : await buildWorksQuery().order("title").limit(2000)

  if (error) throw new Error(error.message)

  const synopsisPredictions = await synopsisPredictionsPromise
  const primarySynopses = await primarySynopsisPromise
  // Leitores pessoais disparados lá em cima — já rodaram em paralelo com a query principal.
  // A partir daqui `personal`/`scoresReader` são consumidos ao montar/filtrar as entries.
  const personal = await personalPromise
  const scoresReader = await scoresReaderPromise

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
    const state = personal.get(w.id)
    const personalStatusId = state.personalStatusId
    const scores: Record<string, number> = {}
    for (const cs of w.category_scores ?? []) {
      scores[cs.criterion_slug] = cs.score
    }
    const synopsisPred = synopsisPredictions.get(w.id) ?? null

    // A linha de scores de QUEM OLHA. Os campos de catálogo (platform_avg, total_votes) passam
    // intactos; os pessoais (Nota Prevista, Chance, Alinhamento) viram os dela — ou null.
    w.calculated_scores = scoresReader.overlay(w.id, w.calculated_scores)

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
      artPercentile: w.calculated_scores?.art_percentile ?? null,
      artBand: artBandFromPercentile(w.calculated_scores?.art_percentile ?? null),
      alignmentScore: w.calculated_scores?.alignment_score ?? null,
      alignmentJustification: w.calculated_scores?.alignment_justification ?? null,
      alignmentAt: w.calculated_scores?.alignment_at ?? null,
      alignmentStale: Boolean(w.calculated_scores?.alignment_stale),
      alignmentPayload: w.calculated_scores?.alignment_payload ?? null,
      userScore: state.userScore,
      isFavorite: state.isFavorite,
      isAdult: Boolean(w.is_adult),
      publicationStatus: getPublicationStatusNameById(publicationStatusId) ?? "Unknown",
      publicationStatusId,
      publicationStatusShort: publicationStatusDisplay?.short ?? null,
      publicationStatusColor: publicationStatusDisplay?.color ?? null,
      hiatusKind: w.hiatus_kind ?? null,
      hiatusKindConfidence: w.hiatus_kind_confidence ?? null,
      publicationStatusNote: w.publication_status_note ?? null,
      personalStatus: personalStatusNameOrDefault(personalStatusId),
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
  // Páginas tipo /titles e /favorites passam includeFinishedDropped=true. "Só
  // avaliadas" também desliga isto (avaliar ≈ terminou → esconder terminais
  // apagaria quase todo o conjunto que o filtro quer mostrar).
  if (!filters.includeFinishedDropped && !filters.onlyRated) {
    // Antes: ["Finalizado", "Droppado", "Completed", "Dropped"] — português E inglês, chutando as
    // duas grafias porque o conceito "a leitura acabou" não tinha casa. Agora tem: vem do banco
    // (`personal_status.is_terminal`, migration 155).
    entries = entries.filter((e) => !isTerminalPersonalStatus(e.personalStatus))
  }

  // "Só avaliadas": mantém apenas obras com nota pessoal (as que treinaram o modelo).
  if (filters.onlyRated) {
    entries = entries.filter((e) => e.userScore != null)
  }

  if (filters.publicationStatus?.length) {
    entries = entries.filter((e) => filters.publicationStatus!.includes(e.publicationStatus))
  }
  if (filters.publicationStatusExclude?.length) {
    entries = entries.filter((e) => !filters.publicationStatusExclude!.includes(e.publicationStatus))
  }
  if (filters.personalStatus?.length) {
    entries = entries.filter((e) => filters.personalStatus!.includes(e.personalStatus))
  }
  // 🔴 Exclusão de status PESSOAL só existe aqui — não há par em SQL, pelo mesmo motivo
  // do positivo (ver o comentário em `personalFilterIds`): obra SEM linha de estado É
  // "Want to Read", e uma lista de ids só enxerga quem TEM linha. Excluir "Want to Read"
  // em SQL deixaria passar justamente as obras que nunca foram tocadas — o conjunto
  // maior, e exatamente o que o usuário pediu para tirar.
  if (filters.personalStatusExclude?.length) {
    entries = entries.filter((e) => !filters.personalStatusExclude!.includes(e.personalStatus))
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
      // Inclui a sentinela do chip "Outros" ("none") — ver matchesManualInterest.
      const manualMatch = wantedSynopsis != null && matchesManualInterest(e, wantedSynopsis)
      // Idem do lado da previsão, onde a sentinela "none" ("sem previsão") é o caso
      // COMUM em multi-user: quem ainda não tem taste_profile não tem previsão nenhuma.
      const predMatch = wantedSynopsisPred != null && matchesPredictedInterest(e, wantedSynopsisPred)
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
  //
  // 🔴 SÓ para quem TEM modelo. Sem modelo, `expectedScore` e `personalFit` são null em TODAS
  // as linhas — e estes filtros, que reprovam null, apagam o catálogo inteiro. O sintoma não é
  // um erro: é a Leitora abrindo o /ranking e lendo "Nenhuma obra encontrada com os filtros
  // aplicados" num app com 882 obras. (Foi exatamente o que o teste de dois usuários pegou.)
  //
  // E não dá pra "só tratar null como aprovado" aqui: um mínimo de nota que aprova quem não
  // tem nota não é um filtro, é um enfeite. Para quem não tem eixo pessoal, o filtro pessoal
  // simplesmente NÃO SE APLICA — do mesmo jeito que a ordenação cai na comunidade.
  const fitPct = (e: RankingEntry) =>
    e.personalFitPercentile != null
      ? e.personalFitPercentile
      : e.personalFit != null
        ? e.personalFit * 100
        : null

  if (scoresReader.hasModel) {
    if (filters.minExpectedScore != null) {
      const min = filters.minExpectedScore
      entries = entries.filter((e) => e.expectedScore != null && e.expectedScore >= min)
    }
    if (filters.maxExpectedScore != null) {
      const max = filters.maxExpectedScore
      entries = entries.filter((e) => e.expectedScore != null && e.expectedScore <= max)
    }
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
  // Arte: a regra (inclusive o que fazer com "sem estimativa") mora em `artFilterMatches`,
  // que é o dono único e o que os testes exercitam. Reescrevê-la aqui é como as duas metades
  // da assimetria acabam trocadas.
  if (filters.artFilter) {
    const f = filters.artFilter
    entries = entries.filter((e) => artFilterMatches(e.artBand, f))
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
  if (filters.onlyWithoutFinalScore) {
    entries = entries.filter((e) => e.expectedScore == null)
  }

  // Ordenação
  const levels: SortLevel[] = filters.sortLevels?.length
    ? filters.sortLevels
    : [{ field: filters.sortBy ?? "expected_score", dir: filters.sortDir ?? "desc" }]

  // ⚠️ Sem modelo, não há EIXO PESSOAL — e ordenar por um campo que é null em todas as linhas
  // não devolve "nada": devolve o catálogo em ordem arbitrária, com cara de ranking. Quem não
  // tem os 20 rótulos cai na NOTA DA COMUNIDADE, que é o que o MAL faz e é um fato da obra.
  //
  // Não é degradação: é a única ordenação honesta que existe para essa pessoa. Assim que ela
  // avalia 20 obras, o eixo dela acende e o ranking volta a ser ordenado pela previsão DELA.
  const PERSONAL_SORT_FIELDS = new Set([
    "expected_score",
    "recommended",
    "decision",
    "personal_fit",
    // A arte é estimada a partir dos rótulos DO DONO: para quem não é ele, `artPercentile`
    // vem null pelo overlay, e ordenar por um campo todo-null devolveria o catálogo em ordem
    // arbitrária com cara de "ordenado por arte".
    "art",
    "alignment_score",
    "chance_score",
  ])
  const effectiveLevels: SortLevel[] = scoresReader.hasModel
    ? levels
    : levels.map((lvl) =>
        PERSONAL_SORT_FIELDS.has(lvl.field)
          ? ({ ...lvl, field: "platform_avg" } as SortLevel)
          : lvl,
      )

  function compareByField(a: RankingEntry, b: RankingEntry, field: string, dir: "asc" | "desc"): number {
    const m = dir === "asc" ? 1 : -1
    const rawScore = (value: number | null | undefined) =>
      value == null ? -Infinity : value
    // Nota Prevista ordena pela nota EXIBIDA (1 casa), não pelo valor cru: a lista
    // mostra `expectedScore.toFixed(1)`, então 8,44 e 8,37 aparecem iguais ("8,4").
    // Comparar o cru fazia o 8,44 vir na frente sem empatar — e o critério de
    // desempate seguinte (ex.: Veredito) nunca entrava. Arredondar aqui faz notas
    // que APARECEM iguais empatarem e caírem pro próximo nível de ordenação.
    //
    // 🔴 O arredondamento vem de `roundToDisplayScore` justamente porque o atalho
    // (`Math.round(v * 10) / 10`) NÃO bate com o `toFixed(1)` da tela — ver o
    // porquê e o bug medido em lib/score-rounding.ts.
    const displayScore = (value: number | null | undefined) =>
      value == null ? -Infinity : roundToDisplayScore(value)
    if (field === "title") return m * a.title.localeCompare(b.title)
    if (field === "expected_score")
      return m * (displayScore(a.expectedScore) - displayScore(b.expectedScore))
    if (field === "decision")
      return m * (rawScore(a.decisionScore) - rawScore(b.decisionScore))
    if (field === "recommended")
      // Unificado com expected_score (auditoria 2026-06): o antigo blend
      // `expected × (0.6 + 0.4·personal_fit)` era ruído — pf é ~constante e ordena
      // pior que o acaso. "Recomendado" (default Free) agora = Nota Prevista,
      // agrupada em tiers e diferenciada DENTRO do tier por tag overlap
      // (reorderTiersByFit no cliente). Mesmo eixo → mesmo arredondamento de exibição.
      return m * (displayScore(a.expectedScore) - displayScore(b.expectedScore))
    // Sua nota (Real). Pelo valor EXIBIDO, como a Prevista: a badge mostra 1 casa, então
    // 8,44 e 8,37 aparecem iguais e têm que EMPATAR — senão o desempate seguinte nunca
    // entra. Não vai em PERSONAL_SORT_FIELDS de propósito: quem não avaliou nada não
    // recebe uma ordenação de outro eixo com cara de "Minha nota" — as vazias vão pro fim
    // (-Infinity) e o desempate final (overlap de tags, título) decide o resto.
    if (field === "user_score") return m * (displayScore(a.userScore) - displayScore(b.userScore))
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
    // Arte ordena pelo PERCENTIL, nunca pela estimativa em pontos — que nem chega aqui, por
    // não vir no select. Sem estimativa vai pro fim em `desc` (o -Infinity), que é o certo:
    // "não sei" não disputa as primeiras posições com "provavelmente forte".
    if (field === "art") {
      return m * ((a.artPercentile ?? -Infinity) - (b.artPercentile ?? -Infinity))
    }
    // Recorrência (em quantos grupos de favoritos a obra está). Ausente ⇒ 0 para todos, e o
    // nível não decide nada — nunca -Infinity: "em nenhum grupo" é um fato, não um vazio, e
    // com -Infinity a ordem ASC começaria pelas sem grupo em vez de por 0, 1, 2…
    if (field === "groups") {
      const counts = filters.groupCountByWorkId
      return m * ((counts?.[a.workId] ?? 0) - (counts?.[b.workId] ?? 0))
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

  // Desempate FINAL, depois de TODOS os níveis escolhidos: overlap de tags do
  // perfil efetivo (`compareWithinTierTieBreak`), e só então o título.
  //
  // Este desempate morava no CLIENTE (`reorderTiersByFit`, view Lista), aplicado
  // por tier — e ali ele reordenava obras que a pessoa tinha mandado ordenar por
  // outra coisa. Um tier cobre 8,5 → 8,25 na banda de hoje (0,25) e cobria 8,5 → 8,0
  // na banda de 0,5 em que isto foi descoberto, então "dentro do tier tudo
  // empata" era falso: ele descartava tanto o nível 2 escolhido (ex.: Veredito)
  // quanto a própria Nota Prevista. A lista saía numa ordem que nenhum controle
  // da tela explicava.
  //
  // Aqui ele só entra quando NADA mais decidiu — mantém o sinal (tag overlap
  // ordena melhor que ordem alfabética entre empatadas) sem sobrepor escolha
  // nenhuma, e vale igual para Lista, Cards, Faixas e Bússola.
  entries.sort((a, b) => {
    for (const level of effectiveLevels) {
      const cmp = compareByField(a, b, level.field, level.dir)
      if (cmp !== 0) return cmp
    }
    const fit = compareWithinTierTieBreak(a, b)
    if (fit !== 0) return fit
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
