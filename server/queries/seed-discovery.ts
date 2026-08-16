import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPersonalStateReader } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { getHideAdultContent } from "@/server/queries/current-user"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  anchoredCohesionOf,
  classifyCohesion,
  cohesionOf,
  extremesDivergence,
  primaryEffectByStep,
  snapWeight,
  unionOfTops,
  weakestSeed,
  DEFAULT_SIM_WEIGHT,
} from "@/lib/discovery/blend"
import type {
  BlendCandidate,
  CohesionLevel,
  PrimaryEffect,
  SeedPair,
  WeakestSeed,
} from "@/lib/discovery/blend"
import {
  MIN_SEEDS,
  MAX_SEEDS,
  MAX_ANTI_SEEDS,
  DEFAULT_RESULT_LIMIT,
  SEED_SUGGESTION_COUNT,
} from "@/lib/discovery/limits"

/**
 * "Mais como estas" (`/discover`) — o cruzamento entre PARECENÇA com obras-semente e
 * ALINHAMENTO com o perfil de quem olha.
 *
 * A conta pesada mora na RPC `find_similar_to_seeds` (migration 187), que faz a varredura
 * vetorial dentro do Postgres. Aqui só se junta o que é PESSOAL — e é justamente essa
 * junção que a RPC não pode fazer, porque `calculated_scores` é do dono.
 */

// Os limites moram em `lib/discovery/limits.ts` porque a TELA também precisa deles, e este
// módulo é server-only (ver o comentário de lá). Re-exportados para quem já os importa daqui.
export {
  MIN_SEEDS,
  MAX_SEEDS,
  MAX_ANTI_SEEDS,
  DEFAULT_RESULT_LIMIT,
  PRIMARY_SEED_WEIGHT,
} from "@/lib/discovery/limits"

export interface DiscoverySeedInfo {
  id: string
  title: string
  year: number | null
  coverUrl: string | null
  /** false = a obra não tem vetor, então ela foi IGNORADA na busca (hoje 4 obras em 988). */
  hasEmbedding: boolean
}

export interface DiscoveryWork {
  id: string
  title: string
  year: number | null
  totalChapters: number | null
  publicationStatusId: number | null
  personalStatusId: number | null
  isAdult: boolean
  coverUrl: string | null
  synopsis: string | null
  /** Percentil de parecença com as sementes (0–100) dentro do conjunto avaliado. */
  simPercentile: number
  /** Similaridade crua média às sementes — para o tooltip, nunca para ordenar. */
  simRaw: number
  /** Percentil de Alinhamento de quem olha; `null` quando não há perfil. */
  fitPercentile: number | null
  /** O que ordena (0–100). */
  score: number
  /** Qual semente puxou esta obra — o "por que apareceu". */
  nearestSeedId: string | null
  nearestSeedTitle: string | null
  /** Colunas informativas: NUNCA entram no score (ver `lib/discovery/blend.ts`). */
  expectedScore: number | null
  alignmentScore: number | null
  alignmentStale: boolean
  userScore: number | null
}

export interface DiscoveryResult {
  /**
   * O POOL exibível, já ordenado pelo peso corrente — não só o top-N.
   *
   * Contém a união dos tops de todas as paradas do slider (`WEIGHT_STEPS`), para que o
   * cliente reordene sem ir ao servidor. Corte em `DEFAULT_RESULT_LIMIT` na hora de exibir.
   */
  works: DiscoveryWork[]
  seeds: DiscoverySeedInfo[]
  antiSeeds: DiscoverySeedInfo[]
  /** Similaridade média entre TODOS os pares de sementes; `null` com menos de 2 com vetor. */
  cohesion: number | null
  /**
   * A mesma média contando só os pares que tocam a semente PRINCIPAL; `null` sem principal.
   *
   * 🔴 As duas leituras podem dar vereditos opostos sobre as MESMAS sementes, e é o caso que
   * torna a principal delicada: duas coadjuvantes abaixo do acaso entre si derrubam a média
   * geral sem que a busca — ancorada numa terceira — esteja mal dirigida.
   */
  anchoredCohesion: number | null
  /**
   * A faixa da leitura que descreve a BUSCA CORRENTE: ancorada quando há principal, todos os
   * pares quando não há. É ela que decide o tom do card.
   *
   * ⚠️ Não é `classifyCohesion(cohesion)`. Com principal, usar a geral faria o alarme
   * condenar uma busca que a própria ferramenta ancorou — dois critérios para o mesmo fato,
   * a dois centímetros um do outro na tela.
   */
  cohesionLevel: CohesionLevel
  /** Qual semente puxa a coesão para baixo; `null` com menos de 3 ou sem ganho algum. */
  weakest: WeakestSeed | null
  /** A semente com peso dobrado, se houver. */
  primaryId: string | null
  /**
   * Quanto a principal mexe no topo, em CADA parada do slider (alinhado a `WEIGHT_STEPS`).
   * Vazio sem principal.
   */
  primaryEffect: PrimaryEffect[]
  /** Quantas sementes foram ignoradas por não terem embedding. */
  seedsIgnored: number
  /** Total de obras consideradas depois dos filtros — a base dos percentis. */
  candidateCount: number
  /**
   * false quando a pessoa não tem Alinhamento em obra nenhuma (sem perfil de gosto, o caso
   * comum de conta nova). O slider continua funcionando, mas só um dos eixos responde — a
   * UI é obrigada a dizer isso.
   */
  fitAvailable: boolean
  /** Quantas do topo trocam entre as pontas do slider. 0 = o controle não muda nada aqui. */
  extremesDivergence: number
  weight: number
  /**
   * Similaridade entre os pares do pool (`works`), indexada pela POSIÇÃO no array.
   *
   * Serve à diversificação, que roda no cliente junto com a reordenação do slider. Índices
   * e não ids porque o payload é O(n²): com ~50 obras são ~1.200 pares, e uuids dobrariam
   * o tamanho sem acrescentar nada.
   *
   * Vazia quando a RPC `pairwise_similarity` (mig 189) ainda não existe — aí a lista sai
   * sem diversificar, que é a degradação certa.
   */
  simMatrix: number[][]
}

interface SimRow {
  id: string
  sim_pos: number
  /** A mesma parecença com as sementes valendo igual — ver `BlendCandidate.simPosFlat`. */
  sim_pos_flat: number
  sim_neg: number
  nearest_seed_id: string | null
}

interface PairRow {
  a: string
  b: string
  sim: number
}

interface MetaRow {
  id: string
  title: string
  year: number | null
  total_chapters: number | null
  publication_status_id: number | null
  is_adult: boolean | null
  canonical_synopsis: string | null
}

/** Os campos de `calculated_scores` que esta página lê. Todos passam pelo overlay. */
interface CalcScoreRow {
  expected_score: number | null
  personal_fit_percentile: number | null
  alignment_score: number | null
  alignment_stale: boolean | null
}

const EMPTY_CALC: CalcScoreRow = {
  expected_score: null,
  personal_fit_percentile: null,
  alignment_score: null,
  alignment_stale: false,
}

const SCORES_PAGE = 1000

export interface DiscoverBySeedsOptions {
  seedIds: string[]
  antiIds?: string[]
  /** 0 = só alinhamento, 1 = só parecença. */
  weight?: number
  /**
   * Semente com peso dobrado. Ignorada se não estiver entre as sementes — id órfão na URL
   * (semente removida com a estrela nela) tem que degradar para "sem principal", nunca
   * ancorar numa obra que não está mais na busca.
   */
  primaryId?: string | null
  /** Esconde obras já lidas/em curso (default true — a página serve para achar o que ler). */
  onlyUnread?: boolean
  limit?: number
}

/**
 * ⚠️ EXIGE SESSÃO indiretamente: `getScoresReader`/`getPersonalStateReader` usam
 * `getSessionUserId()` e devolvem vazio para anônimo — nunca o estado do dono. A rota
 * `/discover` está em `SIGNED_IN_PREFIXES` para que a página não renderize sem sujeito;
 * este leitor é a 2ª camada, e é a que impede o vazamento se o matcher mudar.
 */
export async function discoverBySeeds(opts: DiscoverBySeedsOptions): Promise<DiscoveryResult> {
  const seedIds = dedupe(opts.seedIds).slice(0, MAX_SEEDS)
  const antiIds = dedupe(opts.antiIds ?? [])
    .filter((id) => !seedIds.includes(id))
    .slice(0, MAX_ANTI_SEEDS)
  const weight = snapWeight(opts.weight ?? DEFAULT_SIM_WEIGHT)
  // Principal órfã degrada para "sem principal": a estrela some junto com a semente.
  const primaryId = opts.primaryId && seedIds.includes(opts.primaryId) ? opts.primaryId : null
  const onlyUnread = opts.onlyUnread ?? true
  const limit = opts.limit ?? DEFAULT_RESULT_LIMIT

  const empty: DiscoveryResult = {
    works: [],
    seeds: [],
    antiSeeds: [],
    cohesion: null,
    anchoredCohesion: null,
    cohesionLevel: "unknown",
    weakest: null,
    primaryId,
    primaryEffect: [],
    seedsIgnored: 0,
    candidateCount: 0,
    fitAvailable: false,
    extremesDivergence: 0,
    weight,
    simMatrix: [],
  }

  const supabase = createAdminClient()

  // 🔴 Abaixo do mínimo ainda se carregam as SEMENTES, e isso não é detalhe: a entrada
  // principal da feature é o botão "Cruzar com outras" da página da obra, que chega aqui
  // com UMA. Devolvendo `empty` a obra escolhida sumia e a pessoa via um formulário vazio,
  // como se o clique não tivesse funcionado. O que falta é o RESULTADO, não a escolha dela.
  if (seedIds.length < MIN_SEEDS) {
    const soSeeds = await loadSeedInfo(supabase, [...seedIds, ...antiIds])
    return { ...empty, seeds: pick(soSeeds, seedIds), antiSeeds: pick(soSeeds, antiIds) }
  }

  const hideAdult = await getHideAdultContent()

  const [simResult, pairResult, seedMeta] = await Promise.all([
    supabase.rpc("find_similar_to_seeds", {
      seed_ids: seedIds,
      anti_ids: antiIds,
      include_adult: !hideAdult,
      primary_seed_id: primaryId,
    }),
    supabase.rpc("seed_pair_similarity", { seed_ids: seedIds }),
    loadSeedInfo(supabase, [...seedIds, ...antiIds]),
  ])

  if (simResult.error) {
    // Tipicamente "function does not exist" antes da migration 187/192 rodar.
    console.warn("[seed-discovery] RPC falhou:", simResult.error.message)
    return empty
  }

  const simRows = (simResult.data as SimRow[] | null) ?? []
  const seedsInfo = pick(seedMeta, seedIds)
  const antiInfo = pick(seedMeta, antiIds)

  // ⚠️ Derivado de `hasEmbedding`, não de um contador próprio da RPC. `loadSeedInfo` já
  // consulta `work_embeddings` para marcar cada chip; um `n_with_embedding` vindo do SQL
  // seria uma 2ª fonte para o mesmo fato — e a que ninguém vê é a que passa a mentir.
  const seedsIgnored = seedsInfo.filter((s) => !s.hasEmbedding).length

  if (simRows.length === 0) return { ...empty, seeds: seedsInfo, antiSeeds: antiInfo, seedsIgnored }

  if (pairResult.error) {
    console.warn("[seed-discovery] seed_pair_similarity falhou:", pairResult.error.message)
  }
  const pairs: SeedPair[] = ((pairResult.data as PairRow[] | null) ?? []).map((p) => ({
    a: p.a,
    b: p.b,
    sim: Number(p.sim),
  }))

  const cohesion = cohesionOf(pairs, seedIds)
  const anchoredCohesion = anchoredCohesionOf(pairs, seedIds, primaryId)
  // A faixa descreve a BUSCA: ancorada quando há principal. Ver o comentário do tipo.
  const cohesionLevel = classifyCohesion(primaryId ? anchoredCohesion : cohesion)
  // Na MESMA régua do veredito — ancorada quando há principal. Ver `weakestSeed`.
  const weakest = weakestSeed(pairs, seedIds, primaryId)

  // Os dois eixos pessoais: estado de leitura e scores derivados de QUEM OLHA.
  const [personal, scoresReader] = await Promise.all([
    getPersonalStateReader(),
    getScoresReader(),
  ])

  // ⚠️ O filtro por status vem ANTES do blend: o percentil de parecença tem que ser medido
  // sobre o mesmo conjunto que a pessoa vê, senão a barra compara contra obras invisíveis.
  const filtered = onlyUnread
    ? simRows.filter((r) => isUnread(personal.get(r.id).personalStatusId))
    : simRows

  if (filtered.length === 0) {
    return {
      ...empty,
      seeds: seedsInfo,
      antiSeeds: antiInfo,
      cohesion,
      anchoredCohesion,
      cohesionLevel,
      weakest,
      seedsIgnored,
    }
  }

  // 🔴 `overlay()` é uma SOBREPOSIÇÃO sobre a linha de `calculated_scores` que a página já
  // buscou — não uma fonte. Para o DONO ele é a identidade (`calcRow => calcRow`), porque
  // aquela tabela já é a dele. Passar um objeto de nulls e esperar dados de volta devolve
  // nulls: medido no app, o dono via "Prev. —", "Ver. —" e o eixo de alinhamento inteiro
  // vazio, com a página anunciando "você ainda não tem perfil de gosto".
  //
  // Então busca-se a linha de catálogo e passa-se ELA pelo overlay: para o dono ela vale
  // como está; para os demais os campos pessoais são trocados pelos de `user_calculated_scores`
  // (ou zerados, nunca herdados dele).
  const catalogScores = await loadCatalogScores(supabase)
  const scoreByWork = new Map<string, CalcScoreRow>()
  for (const r of filtered) {
    scoreByWork.set(r.id, scoresReader.overlay(r.id, catalogScores.get(r.id) ?? EMPTY_CALC))
  }

  const candidates: BlendCandidate[] = filtered.map((r) => ({
    workId: r.id,
    simPos: Number(r.sim_pos),
    // Sem principal a RPC devolve as duas colunas idênticas (conferido no banco), então o
    // caminho de quem não usa a estrela é bit a bit o mesmo de antes.
    simPosFlat: Number(r.sim_pos_flat ?? r.sim_pos),
    simNeg: Number(r.sim_neg ?? 0),
    fitPercentile: numOrNull(scoreByWork.get(r.id)?.personal_fit_percentile),
  }))

  const fitAvailable = candidates.some((c) => c.fitPercentile != null)
  // ⚠️ NÃO é `slice(0, limit)` do peso corrente: o slider reordena no cliente, e uma obra
  // que entra no top só num peso extremo apareceria sem título. `unionOfTops` traz o que
  // qualquer parada do slider pode mostrar — ver WEIGHT_STEPS.
  const top = unionOfTops(candidates, limit, weight)

  const poolIds = top.map((t) => t.workId)
  // Metadados só do pool exibível — o conjunto avaliado tem ~1000 linhas.
  const [meta, simMatrix, covers] = await Promise.all([
    loadMeta(supabase, poolIds),
    loadSimMatrix(supabase, poolIds),
    loadCoverUrls(supabase, poolIds),
  ])
  const simByWork = new Map(simRows.map((r) => [r.id, r]))

  const works: DiscoveryWork[] = top.map((b) => {
    const m = meta.get(b.workId)
    const sc = scoreByWork.get(b.workId)
    const state = personal.get(b.workId)
    const nearestId = simByWork.get(b.workId)?.nearest_seed_id ?? null

    return {
      id: b.workId,
      title: m?.title ?? "(sem título)",
      year: m?.year ?? null,
      totalChapters: m?.total_chapters ?? null,
      publicationStatusId: m?.publication_status_id ?? null,
      personalStatusId: state.personalStatusId,
      isAdult: Boolean(m?.is_adult),
      // 🔴 `seedMeta` só contém SEMENTES e ANTI-SEMENTES: para uma obra do resultado o
      // `get()` devolvia sempre `undefined`, então a lista NUNCA mostrou capa — todas as 24
      // linhas caíam no placeholder cinza, que lê como "esta obra não tem capa". Medido na
      // nuvem: 980 obras, ZERO sem capa. O fallback continua porque obra nova pode ainda
      // não ter, mas agora ele é a exceção e não a regra.
      coverUrl: covers.get(b.workId) ?? seedMeta.get(b.workId)?.coverUrl ?? null,
      synopsis: (m?.canonical_synopsis ?? "").trim() || null,
      simPercentile: b.simPercentile,
      simRaw: b.simPos,
      fitPercentile: b.fitPercentile,
      score: b.score,
      nearestSeedId: nearestId,
      nearestSeedTitle: nearestId ? (seedMeta.get(nearestId)?.title ?? null) : null,
      expectedScore: numOrNull(sc?.expected_score),
      alignmentScore: numOrNull(sc?.alignment_score),
      alignmentStale: Boolean(sc?.alignment_stale),
      userScore: state.userScore,
    }
  })

  return {
    works,
    seeds: seedsInfo,
    antiSeeds: antiInfo,
    cohesion,
    anchoredCohesion,
    cohesionLevel,
    weakest,
    primaryId,
    // Só custa as 22 ordenações quando há estrela — sem ela as duas listas são a mesma.
    primaryEffect: primaryId ? primaryEffectByStep(candidates, Math.min(limit, 10)) : [],
    seedsIgnored,
    candidateCount: candidates.length,
    fitAvailable,
    extremesDivergence: extremesDivergence(candidates, Math.min(limit, 10)),
    weight,
    simMatrix,
  }
}

/** Uma obra oferecida como substituta da semente que está destoando. */
export interface SeedSuggestion extends DiscoverySeedInfo {
  /** A coesão que a busca teria com esta obra no lugar da destoante. */
  cohesionIfPicked: number
  cohesionLevelIfPicked: CohesionLevel
}

/**
 * "Trocar por outra": obras que combinam com as sementes que FICAM.
 *
 * 🔴 Aqui cortar um top-K na RPC é CERTO, ao contrário da busca principal. Lá o corte
 * enviesaria o percentil de parecença, que é medido sobre o conjunto devolvido; aqui não há
 * percentil nenhum — quer-se literalmente "as mais próximas destas". Por isso `match_limit`
 * é 40 e não 5000: o payload cai de ~140 KB para poucos KB.
 *
 * ⚠️ É uma consulta A MAIS, e é por isso que a tela só a dispara sob clique. Automática, ela
 * pagaria a varredura em toda visita a uma busca de coesão baixa — inclusive nas que a
 * pessoa já decidiu manter como estão.
 *
 * O número que a tela mostra em cada sugestão é a coesão RESULTANTE, não um ganho abstrato:
 * uma primeira versão do mockup mostrava "+0,31" e a troca terminava abaixo do corte — a
 * ferramenta recomendando algo que não resolvia. Todas as coesões saem de UMA chamada a
 * `seed_pair_similarity` sobre a união (mantidas + candidatas).
 */
export async function suggestSeedReplacements(
  keepIds: string[],
  excludeIds: string[],
): Promise<SeedSuggestion[]> {
  const manter = dedupe(keepIds)
  if (manter.length === 0) return []

  const supabase = createAdminClient()
  const hideAdult = await getHideAdultContent()

  const { data, error } = await supabase.rpc("find_similar_to_seeds", {
    seed_ids: manter,
    anti_ids: [],
    match_limit: 40,
    include_adult: !hideAdult,
  })

  if (error) {
    console.warn("[seed-discovery] sugestões falharam:", error.message)
    return []
  }

  const proibidos = new Set([...manter, ...excludeIds])
  const candidatos = ((data as SimRow[] | null) ?? [])
    .filter((r) => !proibidos.has(r.id))
    .slice(0, SEED_SUGGESTION_COUNT)
    .map((r) => r.id)

  if (candidatos.length === 0) return []

  const [pairResult, info] = await Promise.all([
    supabase.rpc("seed_pair_similarity", { seed_ids: [...manter, ...candidatos] }),
    loadSeedInfo(supabase, candidatos),
  ])

  const pairs: SeedPair[] = ((pairResult.data as PairRow[] | null) ?? []).map((p) => ({
    a: p.a,
    b: p.b,
    sim: Number(p.sim),
  }))

  const out: SeedSuggestion[] = []
  for (const id of candidatos) {
    const base = info.get(id)
    if (!base) continue
    const c = cohesionOf(pairs, [...manter, id])
    if (c == null) continue
    out.push({ ...base, cohesionIfPicked: c, cohesionLevelIfPicked: classifyCohesion(c) })
  }

  // Melhor coesão primeiro — a ordem da RPC é por parecença com as mantidas, que é parecida
  // mas não igual: o que a pessoa escolhe pelo número tem que estar em cima.
  return out.sort((a, b) => b.cohesionIfPicked - a.cohesionIfPicked)
}

/**
 * Matriz de similaridade entre os candidatos do pool, para a diversificação.
 *
 * ⚠️ É O(n²): pedir isto para o conjunto avaliado (~1.000 obras) seriam 500 mil pares. Só
 * para o pool exibível, que é o único lugar onde a diversificação atua.
 *
 * ⚠️ Falha vira matriz VAZIA, não exceção: sem a mig 189 a página continua servindo a lista
 * (sem diversificar) em vez de quebrar inteira por causa de um refinamento.
 */
async function loadSimMatrix(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<number[][]> {
  if (ids.length < 2) return []

  const { data, error } = await supabase.rpc("pairwise_similarity", { work_ids: ids })
  if (error) {
    console.warn("[seed-discovery] pairwise_similarity falhou:", error.message)
    return []
  }

  const pos = new Map(ids.map((id, i) => [id, i]))
  const m: number[][] = ids.map(() => new Array(ids.length).fill(0))
  for (const row of (data as Array<{ a: string; b: string; sim: number }> | null) ?? []) {
    const i = pos.get(row.a)
    const j = pos.get(row.b)
    if (i == null || j == null) continue
    const v = Number(row.sim)
    // A RPC devolve só o triângulo superior; espelha aqui.
    m[i][j] = v
    m[j][i] = v
  }
  return m
}

// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Carrega os scores derivados do CATÁLOGO (a linha do dono) para todas as obras.
 *
 * ⚠️ PAGINADO: o `select` do PostgREST corta em 1000 linhas sem erro e sem aviso, e o
 * catálogo já tem 988. Sem paginar, a feature nasceria certa e começaria a perder obras
 * silenciosamente no dia em que a milésima entrasse — só as últimas, só às vezes.
 *
 * ⚠️ Todas as obras, não só as do topo: o blend precisa do alinhamento de CADA candidato
 * para ordenar e para calcular percentil. São ~5 colunas × 1000 linhas.
 */
async function loadCatalogScores(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, CalcScoreRow>> {
  const out = new Map<string, CalcScoreRow>()

  for (let from = 0; ; from += SCORES_PAGE) {
    const { data, error } = await supabase
      .from("calculated_scores")
      .select("work_id, expected_score, personal_fit_percentile, alignment_score, alignment_stale")
      .order("work_id", { ascending: true })
      .range(from, from + SCORES_PAGE - 1)

    if (error) {
      console.warn("[seed-discovery] calculated_scores falhou:", error.message)
      break
    }
    if (!data?.length) break
    for (const row of data as Array<CalcScoreRow & { work_id: string }>) {
      const { work_id, ...rest } = row
      out.set(work_id, rest)
    }
    if (data.length < SCORES_PAGE) break
  }

  return out
}

/**
 * Capa + título das sementes (e das obras do topo, reaproveitando a mesma query).
 *
 * Busca as capas com uma query própria porque `work_covers` tem várias linhas por obra e o
 * embed do PostgREST traria todas.
 */
async function loadSeedInfo(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, DiscoverySeedInfo>> {
  const out = new Map<string, DiscoverySeedInfo>()
  if (ids.length === 0) return out

  const [worksResult, coversResult, embResult] = await Promise.all([
    supabase.from("works").select("id, title, year").in("id", ids),
    supabase
      .from("work_covers")
      .select("work_id, url, is_primary, position")
      .in("work_id", ids),
    supabase.from("work_embeddings").select("work_id").in("work_id", ids),
  ])

  const coverByWork = new Map<string, string>()
  const covers = (coversResult.data ?? []) as Array<{
    work_id: string
    url: string
    is_primary: boolean | null
    position: number | null
  }>
  for (const c of [...covers].sort(
    (a, b) =>
      Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
      (a.position ?? 999) - (b.position ?? 999),
  )) {
    if (!coverByWork.has(c.work_id)) coverByWork.set(c.work_id, c.url)
  }

  const withEmbedding = new Set(
    ((embResult.data ?? []) as Array<{ work_id: string }>).map((r) => r.work_id),
  )

  for (const w of ((worksResult.data ?? []) as Array<{
    id: string
    title: string
    year: number | null
  }>)) {
    out.set(w.id, {
      id: w.id,
      title: w.title,
      year: w.year,
      coverUrl: coverByWork.get(w.id) ?? null,
      hasEmbedding: withEmbedding.has(w.id),
    })
  }

  return out
}

/**
 * A capa de cada obra do pool exibível.
 *
 * Query própria porque `work_covers` tem VÁRIAS linhas por obra — um embed do PostgREST
 * traria todas. A escolha (primária, depois posição) é a mesma de `loadSeedInfo`.
 *
 * ⚠️ ~50 obras × poucas capas fica muito abaixo do corte de 1000 linhas do PostgREST. Se um
 * dia o pool crescer, isto precisa paginar como o resto do arquivo já faz.
 */
async function loadCoverUrls(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from("work_covers")
    .select("work_id, url, is_primary, position")
    .in("work_id", ids)

  if (error) {
    console.warn("[seed-discovery] capas falharam:", error.message)
    return out
  }

  const linhas = (data ?? []) as Array<{
    work_id: string
    url: string
    is_primary: boolean | null
    position: number | null
  }>
  for (const c of [...linhas].sort(
    (a, b) =>
      Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
      (a.position ?? 999) - (b.position ?? 999),
  )) {
    if (!out.has(c.work_id)) out.set(c.work_id, c.url)
  }
  return out
}

async function loadMeta(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, MetaRow>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from("works")
    .select("id, title, year, total_chapters, publication_status_id, is_adult, canonical_synopsis")
    .in("id", ids)

  if (error) {
    console.warn("[seed-discovery] meta falhou:", error.message)
    return new Map()
  }
  return new Map(((data ?? []) as MetaRow[]).map((m) => [m.id, m]))
}

/**
 * "Não lida" pela flag semântica do status, nunca por lista de ids na mão — status novo no
 * Supabase entra na régua sozinho (mesma regra da prateleira "Pra você hoje").
 *
 * ⚠️ Obra SEM linha no espelho tem `personalStatusId` null e é não-lida por definição: é o
 * caso da maioria do catálogo, e tratá-la como lida esvaziaria a página.
 */
function isUnread(personalStatusId: number | null): boolean {
  if (personalStatusId == null) return true
  return PERSONAL_STATUSES_BY_ID[personalStatusId]?.isUnread ?? true
}

function pick(
  map: Map<string, DiscoverySeedInfo>,
  ids: string[],
): DiscoverySeedInfo[] {
  return ids
    .map((id) => map.get(id))
    .filter((s): s is DiscoverySeedInfo => s != null)
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v)
}
