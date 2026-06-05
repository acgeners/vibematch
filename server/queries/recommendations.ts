import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis, splitSynopsesFromText } from "@/lib/work-derived"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { getCurrentUserId } from "@/server/queries/current-user"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import {
  applyBiasToCategoryScores,
  type AttributeBiasMap,
  type CategoryScoreWithSource,
} from "@/lib/ai-recommendation/calibrated-scores"
import type { CriterionSlug } from "@/types/domain"
import type { CandidateReview, CandidateWorkInput, RatedWorkInput, RecommendationMode } from "@/lib/ai-recommendation/types"
import { getRanking, type RankingFilters } from "@/server/queries/ranking"
import { PROMPT_VERSION as SYNOPSIS_PROMPT_VERSION } from "@/lib/ai-evaluation/synopsis-quality-predictor"

const POST_SCORE_FIELDS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

const RATED_WORK_SELECT = `
  id,
  title,
  user_score,
  personal_status_id,
  post_story_score,
  post_fl_score,
  post_ml_score,
  post_character_development_score,
  post_pacing_score,
  post_art_visual_score,
  post_impact_immersion_score,
  post_originality_score,
  updated_at,
  canonical_synopsis,
  category_scores(criterion_slug, score, source),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position)
`

const CANDIDATE_WORK_SELECT = `
  id,
  title,
  user_score,
  is_favorite,
  canonical_synopsis,
  category_scores(criterion_slug, score, source),
  calculated_scores(platform_avg, total_votes, predicted_score, expected_score, personal_fit),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position),
  work_covers(url, is_primary, position)
`

interface RawCategoryScore {
  criterion_slug: string
  score: number | null
  source?: string | null
}

interface RawTagRow {
  tag_id?: string | null
  tags?: { name?: string | null; tag_group_id?: string | null } | null
}

interface RawSynopsisRow {
  text?: string | null
  is_primary?: boolean | null
  position?: number | null
}

interface RawCoverRow {
  url?: string | null
  is_primary?: boolean | null
  position?: number | null
}

function buildTags(rows: RawTagRow[] | null | undefined): Array<{ name: string; group: string | null }> {
  return (rows ?? [])
    .map((wt) => wt.tags)
    .filter((t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null) : null,
    }))
}

// Aplica o offset de atributos (Fase 1.5) on-read antes de mandar pros prompts
// de recomendação — o LLM vê os atributos na percepção calibrada do usuário.
function buildCategoryScores(
  rows: RawCategoryScore[] | null | undefined,
  biasMap: AttributeBiasMap,
) {
  const withSource: Partial<Record<CriterionSlug, CategoryScoreWithSource>> = {}
  for (const row of rows ?? []) {
    if (row.score == null) continue
    withSource[row.criterion_slug as CriterionSlug] = {
      value: Number(row.score),
      source: (row.source ?? "imported") as CategoryScoreWithSource["source"],
    }
  }
  const calibrated = applyBiasToCategoryScores(withSource, biasMap)
  const out: Partial<Record<CriterionSlug, number>> = {}
  for (const [slug, v] of Object.entries(calibrated)) {
    if (v != null) out[slug as CriterionSlug] = v
  }
  return out
}

/** Carrega o offset de atributos do usuário atual (uma vez por consulta). */
async function loadBiasMapForRecs(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<AttributeBiasMap> {
  return getBiasMap(await getCurrentUserId(supabase), supabase)
}

/**
 * Sinopse usada nos prompts de recomendação. Prefere `canonical_synopsis`
 * (consolidada via IA). Se não existir, faz fallback split + bloco mais longo
 * em cima da `pickPrimarySynopsis` — evita o problema antigo de truncar no
 * meio da primeira sinopse concatenada.
 */
function pickRecommendationSynopsis(
  canonical: string | null | undefined,
  rawRows: RawSynopsisRow[] | null | undefined,
): string | null {
  if (canonical && canonical.trim()) return canonical.trim()
  const raw = pickPrimarySynopsis(rawRows)
  if (!raw) return null
  const blocks = splitSynopsesFromText(raw)
  if (blocks.length === 0) return raw
  return [...blocks].sort((a, b) => b.length - a.length)[0] ?? raw
}

// Review "crítica" = bucket negativo. Espelha a convenção do merge externo
// (lib/external/index.ts: low = userRating <= 4) pra ficar consistente.
const CRITICAL_RATING_MAX = 4

interface ScoredReview {
  source: string
  text: string
  rating: number | null
  /** match_score × COALESCE(rating, 5): relevância (casamento × sentimento). */
  relevance: number
  /** match_score isolado: confiança de que a review é desta obra. */
  match: number
}

/**
 * Escolhe `perWork` reviews por obra. A partir de 3 vagas, reserva 1 pra uma
 * review CRÍTICA bem-casada (rating ≤ 4, match > 0) — assim o modelo recebe um
 * contraponto pro campo `risks`, em vez de só as mais bem-avaliadas. As demais
 * vagas vão pras de maior relevância. Sem review crítica relevante, cai no
 * comportamento antigo (top-N por relevância).
 */
function pickBalancedReviews(list: ScoredReview[], perWork: number): CandidateReview[] {
  const toReview = (r: ScoredReview): CandidateReview => ({
    source: r.source,
    text: r.text,
    rating: r.rating,
  })
  const byRelevance = [...list].sort((a, b) => b.relevance - a.relevance)
  if (perWork < 3 || list.length <= perWork) {
    return byRelevance.slice(0, perWork).map(toReview)
  }
  const top = byRelevance.slice(0, perWork - 1)
  const topSet = new Set(top)
  const critical = list
    .filter((r) => !topSet.has(r) && r.match > 0 && r.rating != null && r.rating <= CRITICAL_RATING_MAX)
    .sort((a, b) => a.rating! - b.rating! || b.match - a.match)[0]
  const chosen = critical ? [...top, critical] : byRelevance.slice(0, perWork)
  return chosen.map(toReview)
}

/**
 * Top-N reviews por obra, batch. Combina relevância (`match_score *
 * COALESCE(user_rating, 5)`) com 1 vaga reservada pra uma review crítica (ver
 * `pickBalancedReviews`). Texto truncado pelo caller via prompts.formatReviews.
 */
async function fetchTopReviewsBatch(
  workIds: string[],
  perWork: number,
): Promise<Map<string, CandidateReview[]>> {
  const out = new Map<string, CandidateReview[]>()
  if (workIds.length === 0) return out
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_reviews")
    .select("work_id, source, text, user_rating, match_score")
    .in("work_id", workIds)
  if (error) {
    console.error("[recommendations] erro lendo reviews:", error)
    return out
  }

  const grouped = new Map<string, ScoredReview[]>()
  for (const row of data ?? []) {
    const r = row as { work_id: string; source: string; text: string | null; user_rating: number | null; match_score: number | null }
    if (!r.text || !r.text.trim()) continue
    const match = r.match_score ?? 0
    const relevance = match * (r.user_rating ?? 5)
    const list = grouped.get(r.work_id) ?? []
    list.push({ source: r.source, text: r.text.trim(), rating: r.user_rating, relevance, match })
    grouped.set(r.work_id, list)
  }
  for (const [workId, list] of grouped) {
    out.set(workId, pickBalancedReviews(list, perWork))
  }
  return out
}

export async function getRatedWorksForProfile(limit = 200): Promise<RatedWorkInput[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(RATED_WORK_SELECT)
    .not("user_score", "is", null)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Falha lendo obras avaliadas: ${error.message}`)
  }

  const biasMap = await loadBiasMapForRecs(supabase)
  return (data ?? []).map((row) => {
    const work = row as unknown as Record<string, unknown>
    const postScores: Partial<Record<string, number>> = {}
    for (const field of POST_SCORE_FIELDS) {
      const v = work[field]
      if (v != null) postScores[field] = Number(v)
    }
    const synopsis = pickRecommendationSynopsis(
      work.canonical_synopsis as string | null | undefined,
      (work.work_synopses as RawSynopsisRow[] | undefined)?.map((s) => ({
        text: s.text ?? null,
        is_primary: s.is_primary ?? null,
        position: s.position ?? null,
      })),
    )
    const personalStatusId = work.personal_status_id as number | null
    const personalStatus = personalStatusId != null
      ? PERSONAL_STATUSES_BY_ID[personalStatusId]?.status ?? null
      : null

    return {
      id: work.id as string,
      title: work.title as string,
      userScore: work.user_score != null ? Number(work.user_score) : null,
      postScores,
      personalStatus,
      synopsis,
      categoryScores: buildCategoryScores(work.category_scores as RawCategoryScore[] | null, biasMap),
      tags: buildTags(work.work_tags as RawTagRow[] | null),
    } satisfies RatedWorkInput
  })
}

export interface FavoriteCandidate extends CandidateWorkInput {
  coverUrl: string | null
  isAlreadyRated: boolean
}

function mapRowToCandidate(
  row: unknown,
  reviews: CandidateReview[],
  biasMap: AttributeBiasMap,
): FavoriteCandidate {
  const work = row as Record<string, unknown>
  const calc = (work.calculated_scores as { platform_avg?: number | null; total_votes?: number | null; predicted_score?: number | null; expected_score?: number | null; personal_fit?: number | null } | null) ?? null
  const synopsis = pickRecommendationSynopsis(
    work.canonical_synopsis as string | null | undefined,
    (work.work_synopses as RawSynopsisRow[] | undefined)?.map((s) => ({
      text: s.text ?? null,
      is_primary: s.is_primary ?? null,
      position: s.position ?? null,
    })),
  )
  const coverUrl = pickPrimaryCover(
    (work.work_covers as RawCoverRow[] | undefined)?.map((c) => ({
      url: c.url ?? null,
      is_primary: c.is_primary ?? null,
      position: c.position ?? null,
    })),
  )

  return {
    id: work.id as string,
    title: work.title as string,
    synopsis,
    categoryScores: buildCategoryScores(work.category_scores as RawCategoryScore[] | null, biasMap),
    tags: buildTags(work.work_tags as RawTagRow[] | null),
    expectedScore: calc?.expected_score != null ? Number(calc.expected_score) : null,
    fitScore: calc?.personal_fit != null ? Number(calc.personal_fit) : null,
    platformAvg: calc?.platform_avg != null ? Number(calc.platform_avg) : null,
    totalVotes: calc?.total_votes != null ? Number(calc.total_votes) : null,
    predictedScore: calc?.predicted_score != null ? Number(calc.predicted_score) : null,
    reviews,
    coverUrl,
    isAlreadyRated: work.user_score != null,
  } satisfies FavoriteCandidate
}

export async function getFavoriteCandidates(
  mode: Extract<RecommendationMode, "next_read" | "full_analysis">,
  limit = 20,
): Promise<FavoriteCandidate[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("works")
    .select(CANDIDATE_WORK_SELECT)
    .eq("is_favorite", true)
    .eq("is_archived", false)

  if (mode === "next_read") {
    query = query.is("user_score", null)
  }

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit)

  if (error) {
    throw new Error(`Falha lendo favoritos: ${error.message}`)
  }

  const rows = data ?? []
  const ids = rows.map((r) => (r as { id: string }).id)
  const reviewsById = await fetchTopReviewsBatch(ids, 3)
  const biasMap = await loadBiasMapForRecs(supabase)
  return rows.map((row) => mapRowToCandidate(row, reviewsById.get((row as { id: string }).id) ?? [], biasMap))
}

/**
 * Candidatos do ranking: usa os filtros aplicados na página /ranking, pega os
 * top-N por `final_score` (a ordenação default de `getRanking`) e hidrata os
 * mesmos campos que `getFavoriteCandidates` retorna. Inclui obras NÃO
 * favoritadas — foco em descoberta.
 */
export async function getRankingCandidates(
  filters: RankingFilters,
  limit = 20,
): Promise<FavoriteCandidate[]> {
  // Pool de candidatos = top-N por Nota Esperada (a previsão de referência),
  // não por final_score legado. Sobrepõe o sort de exibição da página.
  const entries = await getRanking({ ...filters, sortBy: "expected_score", sortDir: "desc", topN: limit })
  if (entries.length === 0) return []
  const ids = entries.map((e) => e.workId)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(CANDIDATE_WORK_SELECT)
    .in("id", ids)
  if (error) throw new Error(`Falha hidratando candidatos do ranking: ${error.message}`)

  const reviewsById = await fetchTopReviewsBatch(ids, 3)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, reviewsById.get(id) ?? [], biasMap))
  }
  // Preserva a ordem do ranking original.
  return ids.map((id) => byId.get(id)).filter((c): c is FavoriteCandidate => Boolean(c))
}

/**
 * Hidrata uma obra única como `FavoriteCandidate`. Usado pelo re-rank
 * sob demanda (1 obra) disparado do botão "Rankear" da cell IA Rk.
 * Filtra obras arquivadas pra evitar consumir LLM call à toa.
 */
export async function getCandidateById(workId: string): Promise<FavoriteCandidate | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(CANDIDATE_WORK_SELECT)
    .eq("id", workId)
    .eq("is_archived", false)
    .maybeSingle()
  if (error) throw new Error(`Falha hidratando obra ${workId}: ${error.message}`)
  if (!data) return null
  const reviewsById = await fetchTopReviewsBatch([workId], 3)
  const biasMap = await loadBiasMapForRecs(supabase)
  return mapRowToCandidate(data, reviewsById.get(workId) ?? [], biasMap)
}

export interface StaleAlignmentWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatusId: number | null
  personalStatusId: number | null
  alignmentScore: number | null
  alignmentAt: string | null
}

/**
 * Lista obras cujo IA Rk (alignment_score) ficou desatualizado — têm
 * alignment_score persistido mas alignment_stale=true (a obra foi editada ou
 * re-avaliada depois do último re-rank). Filtra arquivadas e ordena pelo
 * re-rank mais antigo primeiro. Alimenta a fila de re-rank em lote.
 */
export async function getStaleAlignmentWorks(
  limit = 200,
  opts: { pubStatusIds?: number[]; personalStatusIds?: number[] } = {},
): Promise<StaleAlignmentWork[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("works")
    .select(
      "id, title, publication_status_id, personal_status_id, work_covers(url, is_primary, position), calculated_scores!inner(alignment_score, alignment_at, alignment_stale)",
    )
    .eq("is_archived", false)
    .eq("calculated_scores.alignment_stale", true)
    .not("calculated_scores.alignment_score", "is", null)
  if (opts.pubStatusIds && opts.pubStatusIds.length > 0) {
    query = query.in("publication_status_id", opts.pubStatusIds)
  }
  if (opts.personalStatusIds && opts.personalStatusIds.length > 0) {
    query = query.in("personal_status_id", opts.personalStatusIds)
  }
  const { data, error } = await query.limit(limit)
  if (error) throw new Error(`Falha listando IA Rk desatualizados: ${error.message}`)

  const rows = (data ?? []).map((row) => {
    const w = row as Record<string, unknown>
    const calc =
      (w.calculated_scores as { alignment_score?: number | null; alignment_at?: string | null } | null) ?? null
    return {
      id: w.id as string,
      title: w.title as string,
      publicationStatusId: w.publication_status_id != null ? Number(w.publication_status_id) : null,
      personalStatusId: w.personal_status_id != null ? Number(w.personal_status_id) : null,
      coverUrl: pickPrimaryCover(
        (w.work_covers as RawCoverRow[] | undefined)?.map((c) => ({
          url: c.url ?? null,
          is_primary: c.is_primary ?? null,
          position: c.position ?? null,
        })),
      ),
      alignmentScore: calc?.alignment_score != null ? Number(calc.alignment_score) : null,
      alignmentAt: calc?.alignment_at ?? null,
    } satisfies StaleAlignmentWork
  })
  // Ordena por re-rank mais antigo primeiro (PostgREST não ordena por coluna
  // embedada de forma confiável — ordena em JS).
  rows.sort((a, b) => {
    const at = a.alignmentAt ? new Date(a.alignmentAt).getTime() : 0
    const bt = b.alignmentAt ? new Date(b.alignmentAt).getTime() : 0
    return at - bt
  })
  return rows
}

export interface AlignmentQueueWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatusId: number | null
  personalStatusId: number | null
  synopsisQuality: string | null
  expectedScore: number | null
  alignmentScore: number | null
  alignmentStale: boolean
}

/**
 * Fila de IA Rk pra aba /ai-evaluation?tab=ia-rk. Dois estados:
 *   - "stale": tem alignment_score mas alignment_stale=true (re-rank velho)
 *   - "unranked": ainda não tem alignment_score (nunca passou pelo re-rank)
 * Filtra por status (publicação/leitura) em SQL e por estado em JS. Sort é no
 * client. Separada de getStaleAlignmentWorks, que segue alimentando só o
 * re-rank em LOTE de desatualizados (re-rankear a biblioteca inteira de uma vez
 * não faria sentido — custo de LLM).
 */
export async function getAlignmentQueueWorks(opts: {
  states?: Array<"stale" | "unranked">
  pubStatusIds?: number[]
  personalStatusIds?: number[]
  synopsisQualities?: string[]
  limit?: number
}): Promise<AlignmentQueueWork[]> {
  const states: Array<"stale" | "unranked"> = opts.states ?? ["stale", "unranked"]
  const wantStale = states.includes("stale")
  const wantUnranked = states.includes("unranked")
  const supabase = createAdminClient()
  let query = supabase
    .from("works")
    .select(
      "id, title, publication_status_id, personal_status_id, synopsis_quality, work_covers(url, is_primary, position), calculated_scores(expected_score, alignment_score, alignment_stale)",
    )
    .eq("is_archived", false)
  if (opts.pubStatusIds && opts.pubStatusIds.length > 0) {
    query = query.in("publication_status_id", opts.pubStatusIds)
  }
  if (opts.personalStatusIds && opts.personalStatusIds.length > 0) {
    query = query.in("personal_status_id", opts.personalStatusIds)
  }
  if (opts.synopsisQualities && opts.synopsisQualities.length > 0) {
    query = query.in("synopsis_quality", opts.synopsisQualities)
  }
  // Limite alto: com 500+ obras, um cap de 500 (sem order) descartava obras da
  // cauda silenciosamente — uma obra stale ali sumia da aba mas aparecia no
  // badge (que conta todas), gerando divergência aba×badge.
  const { data, error } = await query.limit(opts.limit ?? 5000)
  if (error) throw new Error(`Falha listando fila de IA Rk: ${error.message}`)

  const rows: AlignmentQueueWork[] = []
  for (const row of data ?? []) {
    const w = row as Record<string, unknown>
    const calc =
      (w.calculated_scores as {
        expected_score?: number | null
        alignment_score?: number | null
        alignment_stale?: boolean | null
      } | null) ?? null
    const alignmentScore = calc?.alignment_score != null ? Number(calc.alignment_score) : null
    const alignmentStale = Boolean(calc?.alignment_stale)
    const isStale = alignmentScore != null && alignmentStale
    const isUnranked = alignmentScore == null
    if (!((wantStale && isStale) || (wantUnranked && isUnranked))) continue
    rows.push({
      id: w.id as string,
      title: w.title as string,
      coverUrl: pickPrimaryCover(
        (w.work_covers as RawCoverRow[] | undefined)?.map((c) => ({
          url: c.url ?? null,
          is_primary: c.is_primary ?? null,
          position: c.position ?? null,
        })),
      ),
      publicationStatusId: w.publication_status_id != null ? Number(w.publication_status_id) : null,
      personalStatusId: w.personal_status_id != null ? Number(w.personal_status_id) : null,
      synopsisQuality: (w.synopsis_quality as string | null) ?? null,
      expectedScore: calc?.expected_score != null ? Number(calc.expected_score) : null,
      alignmentScore,
      alignmentStale,
    })
  }
  return rows
}

/**
 * Hidrata as obras com IA Rk desatualizado como `FavoriteCandidate` pra o
 * re-rank em lote. Mesmo shape que `getRankingCandidates`, mas o pool vem da
 * fila de stale em vez dos top-N do ranking.
 */
export async function getStaleAlignmentCandidates(limit = 200): Promise<FavoriteCandidate[]> {
  const stale = await getStaleAlignmentWorks(limit)
  const ids = stale.map((w) => w.id)
  if (ids.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(CANDIDATE_WORK_SELECT)
    .in("id", ids)
    .eq("is_archived", false)
  if (error) throw new Error(`Falha hidratando candidatos stale: ${error.message}`)

  const reviewsById = await fetchTopReviewsBatch(ids, 3)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, reviewsById.get(id) ?? [], biasMap))
  }
  // Preserva a ordem da fila (re-rank mais antigo primeiro).
  return ids.map((id) => byId.get(id)).filter((c): c is FavoriteCandidate => Boolean(c))
}

/**
 * Conta (head-count) quantas obras têm IA Rk desatualizado. Usado pra exibir o
 * link/badge da fila no header do ranking só quando há o que processar.
 */
export async function countStaleAlignmentWorks(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("calculated_scores")
    .select("work_id", { count: "exact", head: true })
    .eq("alignment_stale", true)
    .not("alignment_score", "is", null)
  if (error) {
    console.warn("[alignment] countStaleAlignmentWorks falhou:", error.message)
    return 0
  }
  return count ?? 0
}

export interface SynopsisQueueWork {
  id: string
  title: string
  coverUrl: string | null
  /** Todas as capas (primária primeiro) — pro fallback quando uma falha. */
  coverUrls: string[]
  publicationStatusId: number | null
  personalStatusId: number | null
  /** Valor MANUAL (works.synopsis_quality). */
  manualSynopsisQuality: string | null
  expectedScore: number | null
  /** Data da última leitura (works.last_read_at) — pra ordenação. */
  lastReadAt: string | null
  /** Previsão IA ATIVA (versão atual se houver, senão a mais recente). */
  predictedQuality: string | null
  predictedPromptVersion: string | null
  predictionStale: boolean
  predictedConfidence: number | null
  justification: string | null
  /** Previsão de uma versão de prompt ANTERIOR (pra comparar v1 × v2 no card). */
  previousPredictedQuality: string | null
  previousPromptVersion: string | null
}

/**
 * Fila da aba /ai-evaluation?tab=sinopse: obras com `canonical_synopsis` que
 * precisam de estimativa de Interesse Sinopse. Três estados (espelha a fila de
 * IA Rk):
 *   - "stale": já têm previsão mas marcada desatualizada (perfil/sinopse mudou)
 *   - "unpredicted": ainda não têm previsão
 *   - "predicted": têm previsão fresca — pra comparar manual × IA em massa
 * Filtra por status em SQL; estado em JS. Sort é no client.
 */
interface SynopsisPredRow {
  predicted_quality?: string | null
  stale?: boolean | null
  confidence?: number | null
  justification?: string | null
  prompt_version?: string | null
}

const SYNOPSIS_QUEUE_SELECT =
  "id, title, publication_status_id, personal_status_id, synopsis_quality, last_read_at, work_covers(url, is_primary, position), calculated_scores(expected_score)"

/** Todas as URLs de capa de uma obra, primária primeiro depois por posição, sem duplicatas. */
function orderedCoverUrls(covers: RawCoverRow[] | undefined): string[] {
  const list = (covers ?? [])
    .filter((c): c is RawCoverRow & { url: string } => Boolean(c?.url))
    .slice()
    .sort((a, b) => {
      const ap = a.is_primary ? 0 : 1
      const bp = b.is_primary ? 0 : 1
      if (ap !== bp) return ap - bp
      return (a.position ?? 9999) - (b.position ?? 9999)
    })
    .map((c) => c.url)
  return [...new Set(list)]
}

export async function getSynopsisQueueWorks(opts: {
  states?: Array<"stale" | "unpredicted" | "predicted">
  pubStatusIds?: number[]
  personalStatusIds?: number[]
  synopsisQualities?: string[]
  limit?: number
}): Promise<SynopsisQueueWork[]> {
  const states: Array<"stale" | "unpredicted" | "predicted"> =
    opts.states ?? ["stale", "unpredicted"]
  const wantStale = states.includes("stale")
  const wantUnpredicted = states.includes("unpredicted")
  const wantPredicted = states.includes("predicted")
  if (!wantStale && !wantUnpredicted && !wantPredicted) return []
  const supabase = createAdminClient()

  // Carrega TODAS as previsões (tabela pequena) — fonte da verdade do estado de
  // cada obra. Evita depender de embed + limite na query de works (que, sem
  // order, descartava previsões silenciosamente além da janela).
  const { data: predRows, error: predErr } = await supabase
    .from("synopsis_quality_predictions")
    .select("work_id, predicted_quality, stale, confidence, justification, prompt_version")
  if (predErr) throw new Error(`Falha lendo previsões de sinopse: ${predErr.message}`)
  // Pode haver VÁRIAS previsões por obra (uma por versão de prompt). Agrupa e
  // escolhe a "ativa" (versão atual, senão a de maior versão) pra exibição.
  const verNum = (v: string | null | undefined) => {
    const m = (v ?? "").match(/(\d+)/)
    return m ? parseInt(m[1], 10) : -1
  }
  const rowsByWork = new Map<string, Array<{ work_id: string } & SynopsisPredRow>>()
  for (const p of predRows ?? []) {
    const row = p as { work_id: string } & SynopsisPredRow
    const list = rowsByWork.get(row.work_id)
    if (list) list.push(row)
    else rowsByWork.set(row.work_id, [row])
  }
  const predByWork = new Map<string, SynopsisPredRow>()
  const prevByWork = new Map<string, SynopsisPredRow>()
  const outdatedWorks = new Set<string>()
  const freshIds: string[] = []
  const staleIds: string[] = []
  for (const [workId, rows] of rowsByWork) {
    const current = rows.find((r) => (r.prompt_version ?? null) === SYNOPSIS_PROMPT_VERSION)
    const sorted = rows.slice().sort((a, b) => verNum(b.prompt_version) - verNum(a.prompt_version))
    const active = current ?? sorted[0]
    predByWork.set(workId, active)
    // Previsão de versão anterior (maior versão != ativa) — pra mostrar v1 × v2.
    const previous = sorted.find((r) => r !== active)
    if (previous) prevByWork.set(workId, previous)
    // "Desatualizada" = sem previsão da versão atual, OU a da versão atual ficou
    // stale (perfil/sinopse mudou). Volta pra fila pra re-previsão em lote.
    const outdated = !current || Boolean(current.stale)
    if (outdated) {
      outdatedWorks.add(workId)
      staleIds.push(workId)
    } else {
      freshIds.push(workId)
    }
  }

  const pubIds = opts.pubStatusIds ?? []
  const personalIds = opts.personalStatusIds ?? []
  const synQ = opts.synopsisQualities ?? []

  const mapWork = (w: Record<string, unknown>): SynopsisQueueWork => {
    const calc = (w.calculated_scores as { expected_score?: number | null } | null) ?? null
    const pred = predByWork.get(w.id as string) ?? null
    const prev = prevByWork.get(w.id as string) ?? null
    const coverUrls = orderedCoverUrls(w.work_covers as RawCoverRow[] | undefined)
    return {
      id: w.id as string,
      title: w.title as string,
      coverUrl: coverUrls[0] ?? null,
      coverUrls,
      publicationStatusId: w.publication_status_id != null ? Number(w.publication_status_id) : null,
      personalStatusId: w.personal_status_id != null ? Number(w.personal_status_id) : null,
      manualSynopsisQuality: (w.synopsis_quality as string | null) ?? null,
      expectedScore: calc?.expected_score != null ? Number(calc.expected_score) : null,
      lastReadAt: (w.last_read_at as string | null) ?? null,
      predictedQuality: (pred?.predicted_quality as string | null) ?? null,
      predictedPromptVersion: (pred?.prompt_version as string | null) ?? null,
      predictionStale: outdatedWorks.has(w.id as string),
      predictedConfidence: pred?.confidence != null ? Number(pred.confidence) : null,
      justification: (pred?.justification as string | null) ?? null,
      previousPredictedQuality: (prev?.predicted_quality as string | null) ?? null,
      previousPromptVersion: (prev?.prompt_version as string | null) ?? null,
    }
  }

  const out = new Map<string, SynopsisQueueWork>()

  // 1) Previstas / desatualizadas — hidratadas POR ID (completas, sem limite de
  // janela). Chunk de 100 IDs pra não estourar o limite de URL do PostgREST.
  const predSideIds = [...(wantStale ? staleIds : []), ...(wantPredicted ? freshIds : [])]
  for (let i = 0; i < predSideIds.length; i += 100) {
    const chunk = predSideIds.slice(i, i + 100)
    let q = supabase
      .from("works")
      .select(SYNOPSIS_QUEUE_SELECT)
      .in("id", chunk)
      .eq("is_archived", false)
      .not("canonical_synopsis", "is", null)
    if (pubIds.length > 0) q = q.in("publication_status_id", pubIds)
    if (personalIds.length > 0) q = q.in("personal_status_id", personalIds)
    if (synQ.length > 0) q = q.in("synopsis_quality", synQ)
    const { data, error } = await q
    if (error) throw new Error(`Falha hidratando previstas/desatualizadas: ${error.message}`)
    for (const w of data ?? []) {
      const row = w as Record<string, unknown>
      out.set(row.id as string, mapWork(row))
    }
  }

  // 2) Não-previstas — obras com sinopse canônica e SEM previsão.
  if (wantUnpredicted) {
    const predIdSet = new Set(predByWork.keys())
    let q = supabase
      .from("works")
      .select(SYNOPSIS_QUEUE_SELECT)
      .eq("is_archived", false)
      .not("canonical_synopsis", "is", null)
      .order("updated_at", { ascending: false })
    if (pubIds.length > 0) q = q.in("publication_status_id", pubIds)
    if (personalIds.length > 0) q = q.in("personal_status_id", personalIds)
    if (synQ.length > 0) q = q.in("synopsis_quality", synQ)
    const { data, error } = await q.limit(opts.limit ?? 1000)
    if (error) throw new Error(`Falha listando não-previstas: ${error.message}`)
    for (const w of data ?? []) {
      const row = w as Record<string, unknown>
      const id = row.id as string
      if (predIdSet.has(id) || out.has(id)) continue
      out.set(id, mapWork(row))
    }
  }

  return [...out.values()]
}

/**
 * Conta as obras que aparecem nos FILTROS PADRÃO da página /ai-evaluation,
 * tratando as três filas como um CONJUNTO DISTINTO de obras (uma obra que cai em
 * mais de uma fila conta uma vez). Usado pelo badge "Avaliação IA (N)" na
 * sidebar. Seleciona só colunas mínimas — roda a cada navegação. Espelha os
 * defaults de parseFilters / parseIaRkStates / parseSynopsisStates em
 * app/ai-evaluation/page.tsx:
 *   - Atributos:        ai_eval_status ∈ {pending, review_pending}
 *   - IA Rk:            "stale" (tem alignment_score e alignment_stale)
 *   - Interesse Sinopse: "stale" + "unpredicted" (sinopse canônica sem previsão fresca)
 */
export async function getAiEvaluationDefaultQueueCount(): Promise<number> {
  const supabase = createAdminClient()

  const [attr, staleScores, synWorks, preds] = await Promise.all([
    // 1) Atributos — default {pending, review-pending}.
    supabase
      .from("works")
      .select("id")
      .in("ai_eval_status", ["pending", "review_pending"])
      .eq("is_archived", false),
    // 2) IA Rk — default {stale}: filtra direto em calculated_scores (conjunto
    //    pequeno) em vez de carregar o catálogo inteiro. Arquivadas são excluídas
    //    abaixo intersectando com works não-arquivadas.
    supabase
      .from("calculated_scores")
      .select("work_id")
      .eq("alignment_stale", true)
      .not("alignment_score", "is", null),
    // 3) Interesse Sinopse — obras (não arquivadas) com sinopse canônica.
    supabase
      .from("works")
      .select("id")
      .eq("is_archived", false)
      .not("canonical_synopsis", "is", null),
    supabase.from("synopsis_quality_predictions").select("work_id, prompt_version, stale"),
  ])

  if (attr.error) throw new Error(`Falha contando fila de atributos: ${attr.error.message}`)
  if (staleScores.error) throw new Error(`Falha contando fila de IA Rk: ${staleScores.error.message}`)
  if (synWorks.error) throw new Error(`Falha contando fila de sinopse: ${synWorks.error.message}`)
  if (preds.error) throw new Error(`Falha lendo previsões de sinopse: ${preds.error.message}`)

  const ids = new Set<string>()

  for (const w of attr.data ?? []) ids.add((w as { id: string }).id)

  // IA Rk stale: exclui arquivadas validando os work_ids contra works não-arquivadas.
  const staleIds = [...new Set((staleScores.data ?? []).map((r) => (r as { work_id: string }).work_id))]
  for (let i = 0; i < staleIds.length; i += 200) {
    const chunk = staleIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from("works")
      .select("id")
      .in("id", chunk)
      .eq("is_archived", false)
    if (error) throw new Error(`Falha validando IA Rk não-arquivadas: ${error.message}`)
    for (const w of data ?? []) ids.add((w as { id: string }).id)
  }

  // Obra sai da fila de sinopse só se tem previsão FRESCA (versão atual e não-stale).
  const freshSynopsis = new Set<string>()
  for (const p of preds.data ?? []) {
    const row = p as { work_id: string; prompt_version: string | null; stale: boolean | null }
    if (row.prompt_version === SYNOPSIS_PROMPT_VERSION && !row.stale) freshSynopsis.add(row.work_id)
  }
  for (const w of synWorks.data ?? []) {
    const id = (w as { id: string }).id
    if (!freshSynopsis.has(id)) ids.add(id)
  }

  return ids.size
}

/**
 * Hidrata obras específicas (por ID) como `FavoriteCandidate`, preservando a
 * ordem dos IDs e filtrando arquivadas. Usado pelo lote da aba Interesse Sinopse,
 * que prevê exatamente as obras visíveis na fila (na ordem que o usuário vê).
 */
export async function getSynopsisCandidatesByIds(ids: string[]): Promise<FavoriteCandidate[]> {
  if (ids.length === 0) return []
  const supabase = createAdminClient()
  // Chunk de 100 ids por request: `.in("id", [...])` codifica cada UUID na URL
  // (~37 chars); 100 ≈ 3.7KB, abaixo do limite de proxy/PostgREST (~16KB).
  const rows: unknown[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from("works")
      .select(CANDIDATE_WORK_SELECT)
      .in("id", chunk)
      .eq("is_archived", false)
    if (error) throw new Error(`Falha hidratando candidatos por ID: ${error.message}`)
    if (data) rows.push(...data)
  }

  const reviewsById = await fetchTopReviewsBatch(ids, 3)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of rows) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, reviewsById.get(id) ?? [], biasMap))
  }
  return ids.map((id) => byId.get(id)).filter((c): c is FavoriteCandidate => Boolean(c))
}

export async function getRunsToday(): Promise<number> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("recommendation_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
  if (error) {
    console.error("[recommendations] erro contando runs:", error)
    return 0
  }
  return count ?? 0
}

interface RawRunRow {
  id: string
  slug: string
  mode: RecommendationMode
  taste_profile_id: string | null
  user_context: string | null
  n_candidates: number
  n_available: number | null
  source_meta: Record<string, unknown> | null
  candidate_work_ids: string[]
  results: unknown
  mode_summary: string | null
  model_name: string
  prompt_version: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  created_at: string
}

export interface RecommendationRunSummary {
  id: string
  slug: string
  mode: RecommendationMode
  userContext: string | null
  nCandidates: number
  topTitles: string[]
  topAlignment: number | null
  lowAlignment: number | null
  createdAt: string
  tasteProfileId: string | null
}

export async function listRecommendationRuns(limit = 50): Promise<RecommendationRunSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select(
      "id, slug, mode, taste_profile_id, user_context, n_candidates, results, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[recommendations] erro listando runs:", error)
    return []
  }

  const rows = (data ?? []) as Array<Pick<RawRunRow, "id" | "slug" | "mode" | "taste_profile_id" | "user_context" | "n_candidates" | "results" | "created_at">>
  const topWorkIds = new Set<string>()
  const perRunTop: Array<{
    runId: string
    ids: string[]
    alignment: number | null
    lowAlignment: number | null
  }> = []
  for (const row of rows) {
    const arr = Array.isArray(row.results)
      ? (row.results as Array<{ work_id?: string; alignment_score?: number }>)
      : []
    const sorted = [...arr]
      .filter((t) => typeof t.alignment_score === "number")
      .sort((a, b) => (b.alignment_score ?? 0) - (a.alignment_score ?? 0))
    // Dedupe defensivo: `results` pode repetir work_id (ranker/persistência).
    const seen = new Set<string>()
    const deduped = sorted.filter((t) => {
      if (!t.work_id || seen.has(t.work_id)) return false
      seen.add(t.work_id)
      return true
    })
    const top = deduped.slice(0, 3)
    for (const t of top) if (t.work_id) topWorkIds.add(t.work_id)
    perRunTop.push({
      runId: row.id,
      ids: top.map((t) => t.work_id ?? "").filter(Boolean),
      alignment: deduped[0]?.alignment_score ?? null,
      lowAlignment: deduped[deduped.length - 1]?.alignment_score ?? null,
    })
  }

  let titleById = new Map<string, string>()
  if (topWorkIds.size > 0) {
    const { data: titles } = await supabase
      .from("works")
      .select("id, title")
      .in("id", [...topWorkIds])
    titleById = new Map((titles ?? []).map((w) => [w.id as string, w.title as string]))
  }

  return rows.map((row) => {
    const meta = perRunTop.find((p) => p.runId === row.id)
    const topTitles = (meta?.ids ?? []).map((id) => titleById.get(id) ?? "(removida)")
    return {
      id: row.id,
      slug: row.slug,
      mode: row.mode,
      userContext: row.user_context,
      nCandidates: row.n_candidates,
      topTitles,
      topAlignment: meta?.alignment ?? null,
      lowAlignment: meta?.lowAlignment ?? null,
      createdAt: row.created_at,
      tasteProfileId: row.taste_profile_id,
    } satisfies RecommendationRunSummary
  })
}

export interface RecommendationRunWithWorks {
  id: string
  slug: string
  mode: RecommendationMode
  userContext: string | null
  modeSummary: string | null
  createdAt: string
  modelName: string
  promptVersion: string
  tasteProfileId: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  nCandidates: number
  nAvailable: number | null
  sourceMeta: Record<string, unknown> | null
  ranked: Array<{
    work_id: string
    alignment_score: number
    justification: string
    top_match_factors: string[]
    work: FavoriteCandidate | null
    coverUrl: string | null
    workMissing: boolean
  }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getRecommendationRun(idOrSlug: string): Promise<RecommendationRunWithWorks | null> {
  const supabase = createAdminClient()
  const column = UUID_RE.test(idOrSlug) ? "id" : "slug"
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("*, mode_summary")
    .eq(column, idOrSlug)
    .maybeSingle()
  if (error) {
    console.error("[recommendations] erro lendo run:", error)
    return null
  }
  if (!data) return null
  const run = data as unknown as RawRunRow & { mode_summary: string | null }

  const rankings = Array.isArray(run.results)
    ? (run.results as Array<{
        work_id?: string
        alignment_score?: number
        justification?: string
        top_match_factors?: string[]
      }>)
    : []

  const workIds = Array.from(
    new Set(rankings.map((r) => r.work_id).filter((id): id is string => Boolean(id))),
  )

  const worksById = new Map<string, FavoriteCandidate>()
  if (workIds.length > 0) {
    const { data: worksData } = await supabase
      .from("works")
      .select(CANDIDATE_WORK_SELECT)
      .in("id", workIds)
    // Pra exibição da run histórica não recarregamos reviews — a justificativa
    // já foi gerada e está congelada no `results`. Reviews entram só na hora
    // de gerar uma run nova.
    const biasMap = await loadBiasMapForRecs(supabase)
    for (const row of worksData ?? []) {
      const id = (row as { id: string }).id
      worksById.set(id, mapRowToCandidate(row, [], biasMap))
    }
  }

  // Defensivo: `results` persistido pode conter o mesmo work_id repetido (o
  // ranker/persistência ocasionalmente duplica). Mantém só a 1ª ocorrência
  // (maior alignment, pós-sort) — senão a UI quebra com keys duplicadas.
  const seenWorkIds = new Set<string>()
  const ranked = rankings
    .filter((r) => typeof r.work_id === "string" && typeof r.alignment_score === "number")
    .sort((a, b) => (b.alignment_score ?? 0) - (a.alignment_score ?? 0))
    .filter((r) => {
      const id = r.work_id as string
      if (seenWorkIds.has(id)) return false
      seenWorkIds.add(id)
      return true
    })
    .map((r) => {
      const work = worksById.get(r.work_id as string) ?? null
      return {
        work_id: r.work_id as string,
        alignment_score: Number(r.alignment_score),
        justification: r.justification ?? "",
        top_match_factors: Array.isArray(r.top_match_factors) ? r.top_match_factors : [],
        work,
        coverUrl: work?.coverUrl ?? null,
        workMissing: work === null,
      }
    })

  return {
    id: run.id,
    slug: run.slug,
    mode: run.mode,
    userContext: run.user_context,
    modeSummary: run.mode_summary,
    createdAt: run.created_at,
    modelName: run.model_name,
    promptVersion: run.prompt_version,
    tasteProfileId: run.taste_profile_id,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    cacheReadTokens: run.cache_read_tokens,
    cacheCreationTokens: run.cache_creation_tokens,
    nCandidates: run.n_candidates,
    nAvailable: run.n_available,
    sourceMeta: run.source_meta,
    ranked,
  }
}
