import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
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
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { CandidateWorkInput, RatedWorkInput, RecommendationMode, ReviewDigest } from "@/lib/ai-recommendation/types"
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
  review_summary,
  category_scores(criterion_slug, score, source),
  calculated_scores(platform_avg, total_votes, expected_score, personal_fit),
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

/**
 * Digest estruturado das reviews (Item C, Passe 2), em lote. Fetch SEPARADO e
 * TOLERANTE (não vai no CANDIDATE_WORK_SELECT): se a migration 103 ainda não foi
 * aplicada, a coluna não existe e o select erraria — aqui a falha cai em mapa
 * vazio (consultor usa o review_summary do Passe 1 como fallback).
 */
export async function fetchReviewDigestsBatch(workIds: string[]): Promise<Map<string, ReviewDigest>> {
  const out = new Map<string, ReviewDigest>()
  if (workIds.length === 0) return out
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("works").select("id, review_digest").in("id", workIds)
  if (error) {
    console.warn("[recommendations] review_digest indisponível (migration 103?):", error.message)
    return out
  }
  for (const row of data ?? []) {
    const r = row as { id: string; review_digest: ReviewDigest | null }
    if (r.review_digest) out.set(r.id, r.review_digest)
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
  biasMap: AttributeBiasMap,
  reviewDigest: ReviewDigest | null = null,
): FavoriteCandidate {
  const work = row as Record<string, unknown>
  const calc = (work.calculated_scores as { platform_avg?: number | null; total_votes?: number | null; expected_score?: number | null; personal_fit?: number | null } | null) ?? null
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
    reviewSummary: (work.review_summary as string | null) ?? null,
    reviewDigest,
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
  const digestById = await fetchReviewDigestsBatch(ids)
  const biasMap = await loadBiasMapForRecs(supabase)
  return rows.map((row) => {
    const id = (row as { id: string }).id
    return mapRowToCandidate(row, biasMap, digestById.get(id) ?? null)
  })
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

  const digestById = await fetchReviewDigestsBatch(ids)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, biasMap, digestById.get(id) ?? null))
  }
  // Preserva a ordem do ranking original.
  return ids.map((id) => byId.get(id)).filter((c): c is FavoriteCandidate => Boolean(c))
}

/**
 * Hidrata uma obra única como `FavoriteCandidate`. Usado pelo re-rank
 * sob demanda (1 obra) disparado do botão "Rankear" da cell Veredito IA.
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
  const digestById = await fetchReviewDigestsBatch([workId])
  const biasMap = await loadBiasMapForRecs(supabase)
  return mapRowToCandidate(data, biasMap, digestById.get(workId) ?? null)
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
 * Lista obras cujo Veredito IA (alignment_score) ficou desatualizado — têm
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
  if (error) throw new Error(`Falha listando Veredito IA desatualizados: ${error.message}`)

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
  /** Todas as capas (primária primeiro) — pro fallback quando uma falha. */
  coverUrls: string[]
  publicationStatusId: number | null
  personalStatusId: number | null
  synopsisQuality: string | null
  expectedScore: number | null
  alignmentScore: number | null
  alignmentStale: boolean
}

/**
 * Fila de Veredito IA pra aba /ai-evaluation?tab=ia-rk. Dois estados:
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
  if (error) throw new Error(`Falha listando fila de Veredito IA: ${error.message}`)

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
    const coverUrls = orderedCoverUrls(w.work_covers as RawCoverRow[] | undefined)
    rows.push({
      id: w.id as string,
      title: w.title as string,
      coverUrl: coverUrls[0] ?? null,
      coverUrls,
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
 * Hidrata as obras com Veredito IA desatualizado como `FavoriteCandidate` pra o
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

  const digestById = await fetchReviewDigestsBatch(ids)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, biasMap, digestById.get(id) ?? null))
  }
  // Preserva a ordem da fila (re-rank mais antigo primeiro).
  return ids.map((id) => byId.get(id)).filter((c): c is FavoriteCandidate => Boolean(c))
}

/**
 * Conta (head-count) quantas obras têm Veredito IA desatualizado. Usado pra exibir o
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
  /** Proveniência do valor: human_manual | prediction_applied | legacy_unknown | null. */
  synopsisQualitySource: string | null
  expectedScore: number | null
  /** Data da última leitura (works.last_read_at) — pra ordenação. */
  lastReadAt: string | null
  /** Previsão IA ATIVA (versão atual se houver, senão a mais recente). */
  predictedQuality: string | null
  predictedPromptVersion: string | null
  /** Data (ISO) da última previsão ATIVA — pra exibir "previsto em…". */
  predictedAt: string | null
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
 * Veredito IA):
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
  predicted_at?: string | null
}

const SYNOPSIS_QUEUE_SELECT =
  "id, title, publication_status_id, personal_status_id, synopsis_quality, synopsis_quality_source, last_read_at, work_covers(url, is_primary, position), calculated_scores(expected_score)"

// Probe defensivo da coluna `synopsis_interest_skipped` (migration 121). Enquanto a
// migration não for aplicada, a fila simplesmente não filtra pulados (não quebra).
let synopsisSkippedColumn: boolean | null = null
async function hasSynopsisInterestSkippedColumn(sb: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (synopsisSkippedColumn != null) return synopsisSkippedColumn
  const { error } = await sb.from("works").select("synopsis_interest_skipped").limit(1)
  synopsisSkippedColumn = !error
  if (error) console.warn("[synopsis-queue] coluna synopsis_interest_skipped ausente — 'Pular' inativo. Aplique a migration 121.")
  return synopsisSkippedColumn
}

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
  /** Filtra pela VERSÃO de prompt da previsão ATIVA (ex.: ["v3"]). Pós-filtro. */
  predictionVersions?: string[]
  /** Filtra pelo VALOR previsto pela IA (♥–♥♥♥♥). Pós-filtro. */
  predictionQualities?: string[]
  /** Filtra pelo DELTA previsto − atual (valores exatos "-3".."3"). Só compara com
   *  valor existente human_manual OU legacy_unknown (não prediction_applied). Pós-filtro. */
  predictionDeltas?: string[]
  /**
   * Triagem manual: ignora o estado de previsão e lista só obras SEM Interesse
   * manual (synopsis_quality IS NULL). Sobrepõe `states`/`synopsisQualities`.
   */
  missingManual?: boolean
  limit?: number
}): Promise<SynopsisQueueWork[]> {
  const states: Array<"stale" | "unpredicted" | "predicted"> =
    opts.states ?? ["unpredicted"]
  const wantStale = states.includes("stale")
  const wantUnpredicted = states.includes("unpredicted")
  const wantPredicted = states.includes("predicted")
  if (!wantStale && !wantUnpredicted && !wantPredicted) return []
  const supabase = createAdminClient()
  // Exclui obras "puladas" (migration 121) — só se a coluna existir (probe).
  const excludeSkipped = await hasSynopsisInterestSkippedColumn(supabase)

  // Carrega TODAS as previsões — fonte da verdade do estado de cada obra. A tabela
  // já passou de 1000 linhas, então pagina (sem isso o PostgREST corta em 1000 e
  // obras previstas reapareceriam como "não previsto").
  const predRows = await fetchAllRows<{ work_id: string } & SynopsisPredRow>(
    (from, to) =>
      supabase
        .from("synopsis_quality_predictions")
        .select("work_id, predicted_quality, stale, confidence, justification, prompt_version, predicted_at")
        .range(from, to),
    "Falha lendo previsões de sinopse",
  )
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
    if (!current || Boolean(current.stale)) outdatedWorks.add(workId)
  }

  const pubIds = opts.pubStatusIds ?? []
  const personalIds = opts.personalStatusIds ?? []
  // "none"/"unknown" são sentinelas de UI — nunca casam num valor real, então são
  // removidos antes de qualquer `.in("synopsis_quality", …)`.
  //  - "none"    = "Não avaliada" (synopsis_quality IS NULL) → via missingManual.
  //  - "unknown" = "Desconhecido": filtra por PROVENIÊNCIA
  //    (synopsis_quality_source = 'legacy_unknown') em vez de valor — separa os
  //    valores legados/não-confirmados dos human_manual.
  const synQ = (opts.synopsisQualities ?? []).filter((q) => q !== "none" && q !== "unknown")
  const unknownSource = (opts.synopsisQualities ?? []).includes("unknown")

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
      synopsisQualitySource: (w.synopsis_quality_source as string | null) ?? null,
      expectedScore: calc?.expected_score != null ? Number(calc.expected_score) : null,
      lastReadAt: (w.last_read_at as string | null) ?? null,
      predictedQuality: (pred?.predicted_quality as string | null) ?? null,
      predictedPromptVersion: (pred?.prompt_version as string | null) ?? null,
      predictedAt: (pred?.predicted_at as string | null) ?? null,
      predictionStale: outdatedWorks.has(w.id as string),
      predictedConfidence: pred?.confidence != null ? Number(pred.confidence) : null,
      justification: (pred?.justification as string | null) ?? null,
      previousPredictedQuality: (prev?.predicted_quality as string | null) ?? null,
      previousPromptVersion: (prev?.prompt_version as string | null) ?? null,
    }
  }

  // Pós-filtros por previsão (versão e/ou valor da IA). Aplicados ao resultado de
  // qualquer caminho (a previsão ativa já vem em predByWork). Excluem obras sem
  // previsão quando algum desses filtros está ativo.
  const predVersions = opts.predictionVersions ?? []
  const predQualities = opts.predictionQualities ?? []
  const predDeltas = opts.predictionDeltas ?? []
  // Nível ordinal do Interesse (♥=1…♥♥♥♥=4; 0 desconhecido) — pro delta.
  const levelOf = (q: string | null): number => {
    if (!q) return 0
    const i = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
    return i >= 0 ? i + 1 : 0
  }
  const postFilter = (works: SynopsisQueueWork[]): SynopsisQueueWork[] => {
    let result = works
    if (predVersions.length > 0)
      result = result.filter((w) => w.predictedPromptVersion != null && predVersions.includes(w.predictedPromptVersion))
    if (predQualities.length > 0)
      result = result.filter((w) => w.predictedQuality != null && predQualities.includes(w.predictedQuality))
    if (predDeltas.length > 0) {
      const wantedDeltas = new Set(predDeltas.map((s) => Number(s)))
      result = result.filter((w) => {
        // Delta só faz sentido com previsão + valor existente human_manual/legacy_unknown.
        if (w.predictedQuality == null || w.manualSynopsisQuality == null) return false
        if (w.synopsisQualitySource !== "human_manual" && w.synopsisQualitySource !== "legacy_unknown") return false
        return wantedDeltas.has(levelOf(w.predictedQuality) - levelOf(w.manualSynopsisQuality))
      })
    }
    return result
  }

  // Triagem manual: lista obras com sinopse canônica e SEM Interesse manual
  // (synopsis_quality IS NULL), independente do estado de previsão. As previsões
  // carregadas acima ainda alimentam a exibição (sugestão IA no card).
  if (opts.missingManual) {
    const baseQ = () => {
      let q = supabase
        .from("works")
        .select(SYNOPSIS_QUEUE_SELECT)
        .eq("is_archived", false)
        .not("canonical_synopsis", "is", null)
        .is("synopsis_quality", null)
        .order("updated_at", { ascending: false })
      if (pubIds.length > 0) q = q.in("publication_status_id", pubIds)
      if (personalIds.length > 0) q = q.in("personal_status_id", personalIds)
      if (excludeSkipped) q = q.eq("synopsis_interest_skipped", false)
      return q
    }
    // Sem limite explícito → pagina (a contagem da aba não pode parar em 1000).
    let data: Record<string, unknown>[]
    if (opts.limit != null) {
      const res = await baseQ().limit(opts.limit)
      if (res.error) throw new Error(`Falha listando obras sem Interesse manual: ${res.error.message}`)
      data = (res.data ?? []) as Record<string, unknown>[]
    } else {
      data = await fetchAllRows<Record<string, unknown>>((from, to) => baseQ().range(from, to), "Falha listando obras sem Interesse manual")
    }
    return postFilter(data.map((w) => mapWork(w)))
  }

  // Scan ÚNICO das obras-com-canônica (filtros em SQL) + classificação por estado
  // em JS (usando predByWork/outdatedWorks). Substitui a hidratação por-ID em
  // chunks de 100 + o scan separado de não-previstas → bem menos round-trips no
  // DB remoto (era ~chunks(414/100)+scan; agora 1 scan paginado).
  const baseQ = () => {
    let q = supabase
      .from("works")
      .select(SYNOPSIS_QUEUE_SELECT)
      .eq("is_archived", false)
      .not("canonical_synopsis", "is", null)
      .order("updated_at", { ascending: false })
    if (pubIds.length > 0) q = q.in("publication_status_id", pubIds)
    if (personalIds.length > 0) q = q.in("personal_status_id", personalIds)
    if (synQ.length > 0) q = q.in("synopsis_quality", synQ)
    if (unknownSource) q = q.eq("synopsis_quality_source", "legacy_unknown")
    if (excludeSkipped) q = q.eq("synopsis_interest_skipped", false)
    return q
  }
  let rows: Record<string, unknown>[]
  if (opts.limit != null) {
    const res = await baseQ().limit(opts.limit)
    if (res.error) throw new Error(`Falha listando fila de Interesse: ${res.error.message}`)
    rows = (res.data ?? []) as Record<string, unknown>[]
  } else {
    rows = await fetchAllRows<Record<string, unknown>>((from, to) => baseQ().range(from, to), "Falha listando fila de Interesse")
  }

  const result: SynopsisQueueWork[] = []
  for (const row of rows) {
    const id = row.id as string
    const hasPred = predByWork.has(id)
    // Estado: sem previsão → unpredicted; previsão desatualizada → stale; senão → predicted.
    const state = !hasPred ? "unpredicted" : outdatedWorks.has(id) ? "stale" : "predicted"
    if (state === "stale" && !wantStale) continue
    if (state === "unpredicted" && !wantUnpredicted) continue
    if (state === "predicted" && !wantPredicted) continue
    result.push(mapWork(row))
  }
  return postFilter(result)
}

/** Versões de prompt distintas presentes em synopsis_quality_predictions (mais nova primeiro). */
export async function getSynopsisPredictionVersions(): Promise<string[]> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ prompt_version: string | null }>(
    (from, to) => supabase.from("synopsis_quality_predictions").select("prompt_version").range(from, to),
    "Falha lendo versões de previsão",
  )
  const versions = new Set<string>()
  for (const r of rows ?? []) if (r.prompt_version) versions.add(r.prompt_version)
  const verNum = (v: string) => {
    const m = v.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : -1
  }
  return [...versions].sort((a, b) => verNum(b) - verNum(a))
}

/**
 * Conta as obras na fila de ATRIBUTOS de /ai-evaluation (aba "IA atributos"):
 * ai_eval_status ∈ {pending, review_pending}, não arquivadas. É o número que
 * alimenta o badge "Avaliação IA" da sidebar — espelha EXATAMENTE o contador
 * dessa aba.
 *
 * Antes, o badge somava a UNIÃO distinta de três filas (atributos ∪ Veredito IA
 * stale ∪ Interesse Sinopse não-previsto). As duas últimas inflavam o número —
 * sobretudo após uma regeneração de perfil, que marca centenas de
 * `alignment_stale` de uma vez — e faziam o badge divergir da aba que o usuário
 * olha. Essas filas têm seus próprios contadores na página; ficam fora do badge.
 *
 * Head-count (`count: "exact", head: true`): agrega no Postgres, sem trafegar
 * linhas nem paginar.
 */
export async function getAttributesQueueCount(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .in("ai_eval_status", ["pending", "review_pending"])
    .eq("is_archived", false)
  if (error) throw new Error(`Falha contando fila de atributos: ${error.message}`)
  return count ?? 0
}

/**
 * Hidrata obras específicas (por ID) como `FavoriteCandidate`, preservando a
 * ordem dos IDs e filtrando arquivadas. Usado pelos lotes que agem exatamente
 * sobre as obras visíveis na fila (na ordem que o usuário vê): Interesse Sinopse
 * e re-rank de Veredito IA.
 */
export async function getCandidatesByIds(ids: string[]): Promise<FavoriteCandidate[]> {
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

  const digestById = await fetchReviewDigestsBatch(ids)
  const biasMap = await loadBiasMapForRecs(supabase)
  const byId = new Map<string, FavoriteCandidate>()
  for (const row of rows) {
    const id = (row as { id: string }).id
    byId.set(id, mapRowToCandidate(row, biasMap, digestById.get(id) ?? null))
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
  /** Run salva via "Salvar desempate" (mode=ranking + source_meta.tiebreak). */
  isTiebreak: boolean
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
      "id, slug, mode, taste_profile_id, user_context, n_candidates, results, source_meta, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[recommendations] erro listando runs:", error)
    return []
  }

  const rows = (data ?? []) as Array<Pick<RawRunRow, "id" | "slug" | "mode" | "taste_profile_id" | "user_context" | "n_candidates" | "results" | "source_meta" | "created_at">>
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
      isTiebreak: (row.source_meta as { tiebreak?: boolean } | null)?.tiebreak === true,
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
    // Exibição da run histórica: a justificativa já está congelada no `results`.
    const biasMap = await loadBiasMapForRecs(supabase)
    for (const row of worksData ?? []) {
      const id = (row as { id: string }).id
      worksById.set(id, mapRowToCandidate(row, biasMap))
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

export interface AlignedWork {
  id: string
  title: string
  coverUrl: string | null
  /** personal_fit determinístico (0–1) — teto baixo (~0.55) por construção. */
  personalFit: number
  /** Percentil (0–100) dentro da biblioteca; comunica "Top X%" de forma mais honesta. */
  personalFitPercentile: number | null
}

/**
 * Top obras mais alinhadas com o TasteProfile atual.
 *
 * Lê o `personal_fit` DETERMINÍSTICO já persistido em `calculated_scores`
 * (computado no último `recalculateAll` — zero LLM, zero recompute aqui). É a
 * mesma métrica de alinhamento que o resto do app usa. Ordena por personal_fit
 * desc em JS (PostgREST não ordena confiável por coluna embedada). Retorna
 * vazio quando não há perfil não-stub — nesse caso o personal_fit fica null
 * pra todas as obras.
 */
export async function getTopAlignedWorks(limit = 5): Promise<AlignedWork[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(
      "id, title, work_covers(url, is_primary, position), calculated_scores!inner(personal_fit, personal_fit_percentile)",
    )
    .eq("is_archived", false)
    .not("calculated_scores.personal_fit", "is", null)
  if (error) throw new Error(`Falha listando obras alinhadas: ${error.message}`)

  return (data ?? [])
    .map((row) => {
      const w = row as Record<string, unknown>
      const calc =
        (w.calculated_scores as {
          personal_fit?: number | null
          personal_fit_percentile?: number | null
        } | null) ?? null
      return {
        id: w.id as string,
        title: w.title as string,
        coverUrl: pickPrimaryCover(
          (w.work_covers as RawCoverRow[] | undefined)?.map((c) => ({
            url: c.url ?? null,
            is_primary: c.is_primary ?? null,
            position: c.position ?? null,
          })),
        ),
        personalFit: calc?.personal_fit != null ? Number(calc.personal_fit) : 0,
        personalFitPercentile:
          calc?.personal_fit_percentile != null ? Number(calc.personal_fit_percentile) : null,
      } satisfies AlignedWork
    })
    .sort((a, b) => b.personalFit - a.personalFit)
    .slice(0, limit)
}
