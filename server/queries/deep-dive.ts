import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis, splitSynopsesFromText } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getCurrentUserId } from "@/server/queries/current-user"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { fetchReviewDigestsBatch } from "@/server/queries/recommendations"
import {
  applyBiasToCategoryScores,
  type AttributeBiasMap,
  type CategoryScoreWithSource,
} from "@/lib/ai-recommendation/calibrated-scores"
import type { CriterionSlug } from "@/types/domain"
import type {
  CandidateReview,
  DeepDiveAlternativeCandidate,
  DeepDiveContext,
  DeepDivePayload,
  DeepDiveResultRow,
  DeepDiveSimilarsBundle,
  DeepDiveWorkBundle,
} from "@/lib/ai-recommendation/types"

const DEEP_DIVE_REVIEWS_CAP = 10
const SIMILARS_FETCH_LIMIT = 20
const SIMILARS_LOVED_CAP = 5
const SIMILARS_AVOIDED_CAP = 3
const SIMILARS_LOVED_THRESHOLD = 7
const SIMILARS_AVOIDED_THRESHOLD = 5
const RECENT_ACTIVITY_LIMIT = 5
const ALTERNATIVES_CAP = 10

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

interface RawTagRow {
  tags?: { name?: string | null; tag_group_id?: string | null } | null
}

interface RawCategoryScoreRow {
  criterion_slug: string
  score: number | null
  source?: string | null
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

interface RawPlatformRatingRow {
  rating: number | null
  vote_count: number | null
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

// Aplica o offset de atributos (Fase 1.5) on-read antes de enviar pro prompt
// do Deep Dive — o LLM enxerga os atributos na percepção calibrada do usuário.
function buildCategoryScores(
  rows: RawCategoryScoreRow[] | null | undefined,
  biasMap: AttributeBiasMap,
): Partial<Record<CriterionSlug, number>> {
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

function pickWorkSynopsis(
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

async function fetchReviewsForWork(workId: string, cap = DEEP_DIVE_REVIEWS_CAP): Promise<CandidateReview[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_reviews")
    .select("source, text, user_rating, match_score")
    .eq("work_id", workId)
  if (error) {
    console.error("[deep-dive] erro lendo reviews:", error)
    return []
  }
  const ranked = (data ?? [])
    .map((row) => {
      const r = row as { source: string; text: string | null; user_rating: number | null; match_score: number | null }
      if (!r.text || !r.text.trim()) return null
      return {
        source: r.source,
        text: r.text.trim(),
        rating: r.user_rating,
        score: (r.match_score ?? 0) * (r.user_rating ?? 5),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((r) => ({ source: r.source, text: r.text, rating: r.rating }))
  return ranked
}

async function fetchWorkBundle(workId: string): Promise<{
  work: DeepDiveWorkBundle
  coverUrl: string | null
} | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(`
      id,
      title,
      canonical_synopsis,
      review_summary,
      post_story_score,
      post_fl_score,
      post_ml_score,
      post_character_development_score,
      post_pacing_score,
      post_art_visual_score,
      post_impact_immersion_score,
      post_originality_score,
      category_scores(criterion_slug, score, source),
      calculated_scores(expected_score, expected_is_stub, personal_fit),
      work_tags(tags(name, tag_group_id)),
      work_synopses(text, is_primary, position),
      work_covers(url, is_primary, position),
      platform_ratings(rating, vote_count)
    `)
    .eq("id", workId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error("[deep-dive] erro lendo work bundle:", error)
    return null
  }

  const row = data as unknown as Record<string, unknown>
  const synopsis = pickWorkSynopsis(
    row.canonical_synopsis as string | null | undefined,
    (row.work_synopses as RawSynopsisRow[] | undefined),
  )
  const coverUrl = pickPrimaryCover(row.work_covers as RawCoverRow[] | undefined)
  const [reviews, digestMap] = await Promise.all([
    fetchReviewsForWork(workId),
    fetchReviewDigestsBatch([workId]),
  ])
  const biasMap = await getBiasMap(await getCurrentUserId(supabase), supabase)

  const postScores: Partial<Record<string, number>> = {}
  for (const field of POST_SCORE_FIELDS) {
    const v = row[field]
    if (v != null) postScores[field] = Number(v)
  }

  const ratings = (row.platform_ratings as RawPlatformRatingRow[] | undefined) ?? []
  const rated = ratings.filter((r) => r.rating != null && (r.vote_count ?? 0) > 0)
  const totalVotes = rated.reduce((sum, r) => sum + (r.vote_count ?? 0), 0)
  const platformAvg =
    rated.length > 0 && totalVotes > 0
      ? rated.reduce((sum, r) => sum + Number(r.rating) * (r.vote_count ?? 0), 0) / totalVotes
      : null

  const calc = (Array.isArray(row.calculated_scores)
    ? row.calculated_scores[0]
    : row.calculated_scores) as
    | { expected_score: number | null; expected_is_stub: boolean | null; personal_fit: number | null }
    | null
    | undefined

  const work: DeepDiveWorkBundle = {
    id: row.id as string,
    title: row.title as string,
    synopsis,
    tags: buildTags(row.work_tags as RawTagRow[] | null),
    categoryScores: buildCategoryScores(row.category_scores as RawCategoryScoreRow[] | null, biasMap),
    postScores,
    platformAvg,
    totalVotes: totalVotes > 0 ? totalVotes : null,
    reviews,
    reviewSummary: (row.review_summary as string | null) ?? null,
    reviewDigest: digestMap.get(workId) ?? null,
    expectedScore: calc?.expected_score ?? null,
    expectedIsStub: calc?.expected_is_stub ?? false,
    fit: calc?.personal_fit ?? null,
  }

  return { work, coverUrl }
}

interface SimilarRow {
  id: string
  title: string
  similarity: number
  user_score: number | null
  cover_url: string | null
  synopsis: string | null
}

async function fetchSimilarsForWork(workId: string): Promise<DeepDiveSimilarsBundle> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("find_similar_works", {
    target_work_id: workId,
    match_limit: SIMILARS_FETCH_LIMIT,
  })
  if (error) {
    console.error("[deep-dive] erro find_similar_works:", error)
    return { loved: [], avoided: [] }
  }
  const rows = (data ?? []) as SimilarRow[]
  const loved: DeepDiveSimilarsBundle["loved"] = []
  const avoided: DeepDiveSimilarsBundle["avoided"] = []
  for (const r of rows) {
    const score = r.user_score != null ? Number(r.user_score) : null
    const entry = {
      id: r.id,
      title: r.title,
      coverUrl: r.cover_url,
      userScore: score,
      similarity: Number(r.similarity ?? 0),
      synopsis: r.synopsis,
    }
    if (score != null && score >= SIMILARS_LOVED_THRESHOLD && loved.length < SIMILARS_LOVED_CAP) {
      loved.push(entry)
    } else if (score != null && score <= SIMILARS_AVOIDED_THRESHOLD && avoided.length < SIMILARS_AVOIDED_CAP) {
      avoided.push(entry)
    }
    if (loved.length === SIMILARS_LOVED_CAP && avoided.length === SIMILARS_AVOIDED_CAP) break
  }
  return { loved, avoided }
}

async function fetchRecentActivity(excludeWorkId: string): Promise<
  Array<{ id: string; title: string; userScore: number | null; updatedAt: string }>
> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, title, user_score, updated_at")
    .not("user_score", "is", null)
    .eq("is_archived", false)
    .neq("id", excludeWorkId)
    .order("updated_at", { ascending: false })
    .limit(RECENT_ACTIVITY_LIMIT)
  if (error) {
    console.error("[deep-dive] erro lendo recent activity:", error)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as { id: string; title: string; user_score: number | string | null; updated_at: string }
    return {
      id: r.id,
      title: r.title,
      userScore: r.user_score != null ? Number(r.user_score) : null,
      updatedAt: r.updated_at,
    }
  })
}

async function fetchLatestAlternativePool(excludeWorkId: string): Promise<DeepDiveAlternativeCandidate[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("results, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    if (error) console.error("[deep-dive] erro lendo recommendation_runs:", error)
    return []
  }
  const raw = (data as { results: unknown }).results
  if (!Array.isArray(raw)) return []
  const entries = (raw as Array<{ work_id?: string; alignment_score?: number }>)
    .filter((r) => typeof r.work_id === "string" && r.work_id !== excludeWorkId)
    .sort((a, b) => (b.alignment_score ?? 0) - (a.alignment_score ?? 0))
    .slice(0, ALTERNATIVES_CAP)

  if (entries.length === 0) return []

  const ids = entries.map((e) => e.work_id as string)
  const { data: works, error: worksError } = await supabase
    .from("works")
    .select("id, title")
    .in("id", ids)
  if (worksError) {
    console.error("[deep-dive] erro lendo títulos das alternativas:", worksError)
    return []
  }
  const titleById = new Map<string, string>(
    (works ?? []).map((w) => [w.id as string, w.title as string]),
  )
  return entries
    .map((e) => {
      const id = e.work_id as string
      const title = titleById.get(id)
      if (!title) return null
      return {
        id,
        title,
        alignmentScore: e.alignment_score != null ? Number(e.alignment_score) : null,
      } satisfies DeepDiveAlternativeCandidate
    })
    .filter((c): c is DeepDiveAlternativeCandidate => c !== null)
}

export interface DeepDiveContextResult {
  context: DeepDiveContext
}

export async function getDeepDiveContext(workId: string): Promise<{
  data?: DeepDiveContextResult
  error?: string
}> {
  const [profileRow, bundle, similars, recentActivity, alternatives] = await Promise.all([
    loadCurrentTasteProfile(),
    fetchWorkBundle(workId),
    fetchSimilarsForWork(workId),
    fetchRecentActivity(workId),
    fetchLatestAlternativePool(workId),
  ])

  if (!profileRow) {
    return {
      error:
        "Perfil de gosto ainda não foi gerado. Acesse /conta/perfil ou avalie obras com user_score pra desbloquear o Deep Dive.",
    }
  }
  if (profileRow.is_stub) {
    return {
      error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o Deep Dive.",
    }
  }
  if (!bundle) {
    return { error: "Obra não encontrada." }
  }

  return {
    data: {
      context: {
        profile: profileRow.profile,
        profileId: profileRow.id,
        work: bundle.work,
        similars,
        alternatives,
        recentActivity,
        workCoverUrl: bundle.coverUrl,
      },
    },
  }
}

// ============================================================
// Leitura/listagem dos deep_dive_results persistidos
// ============================================================

function mapDeepDiveRow(row: Record<string, unknown>): DeepDiveResultRow {
  return {
    id: row.id as string,
    work_id: row.work_id as string,
    taste_profile_id: (row.taste_profile_id as string | null) ?? null,
    user_context: (row.user_context as string | null) ?? null,
    payload: row.payload as DeepDivePayload,
    match_score: row.match_score != null ? Number(row.match_score) : null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    read_when: (row.read_when as DeepDiveResultRow["read_when"]) ?? null,
    one_liner: (row.one_liner as string | null) ?? null,
    model_name: row.model_name as string,
    prompt_version: row.prompt_version as string,
    input_tokens: row.input_tokens != null ? Number(row.input_tokens) : null,
    output_tokens: row.output_tokens != null ? Number(row.output_tokens) : null,
    cache_read_tokens: row.cache_read_tokens != null ? Number(row.cache_read_tokens) : null,
    cache_creation_tokens:
      row.cache_creation_tokens != null ? Number(row.cache_creation_tokens) : null,
    thinking_tokens: row.thinking_tokens != null ? Number(row.thinking_tokens) : null,
    ai_api_call_id: (row.ai_api_call_id as string | null) ?? null,
    created_at: row.created_at as string,
  }
}

export async function getLastDeepDive(workId: string): Promise<DeepDiveResultRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("deep_dive_results")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[deep-dive] erro lendo last deep dive:", error)
    return null
  }
  if (!data) return null
  return mapDeepDiveRow(data as Record<string, unknown>)
}

export async function getDeepDiveHistory(workId: string, limit = 10): Promise<DeepDiveResultRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("deep_dive_results")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[deep-dive] erro lendo histórico:", error)
    return []
  }
  return (data ?? []).map((row) => mapDeepDiveRow(row as Record<string, unknown>))
}

export async function getDeepDivesToday(): Promise<number> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("deep_dive_results")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
  if (error) {
    console.error("[deep-dive] erro contando deep dives do dia:", error)
    return 0
  }
  return count ?? 0
}
