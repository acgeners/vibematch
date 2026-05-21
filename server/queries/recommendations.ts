import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import type { CriterionSlug } from "@/types/domain"
import type { CandidateWorkInput, RatedWorkInput, RecommendationMode } from "@/lib/ai-recommendation/types"

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
  manual_score,
  observations,
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
  category_scores(criterion_slug, score),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position)
`

const CANDIDATE_WORK_SELECT = `
  id,
  title,
  manual_score,
  is_favorite,
  category_scores(criterion_slug, score),
  calculated_scores(platform_avg, total_votes, predicted_score),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position),
  work_covers(url, is_primary, position)
`

interface RawCategoryScore {
  criterion_slug: string
  score: number | null
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

function buildCategoryScores(rows: RawCategoryScore[] | null | undefined) {
  const out: Partial<Record<CriterionSlug, number>> = {}
  for (const row of rows ?? []) {
    if (row.score == null) continue
    out[row.criterion_slug as CriterionSlug] = Number(row.score)
  }
  return out
}

export async function getRatedWorksForProfile(limit = 200): Promise<RatedWorkInput[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(RATED_WORK_SELECT)
    .not("manual_score", "is", null)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Falha lendo obras avaliadas: ${error.message}`)
  }

  return (data ?? []).map((row) => {
    const work = row as unknown as Record<string, unknown>
    const postScores: Partial<Record<string, number>> = {}
    for (const field of POST_SCORE_FIELDS) {
      const v = work[field]
      if (v != null) postScores[field] = Number(v)
    }
    const synopsis = pickPrimarySynopsis(
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
      manualScore: work.manual_score != null ? Number(work.manual_score) : null,
      postScores,
      personalStatus,
      synopsis,
      observation: (work.observations as string | null) ?? null,
      categoryScores: buildCategoryScores(work.category_scores as RawCategoryScore[] | null),
      tags: buildTags(work.work_tags as RawTagRow[] | null),
    } satisfies RatedWorkInput
  })
}

export interface FavoriteCandidate extends CandidateWorkInput {
  coverUrl: string | null
  isAlreadyRated: boolean
}

export async function getFavoriteCandidates(
  mode: RecommendationMode,
  limit = 80,
): Promise<FavoriteCandidate[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("works")
    .select(CANDIDATE_WORK_SELECT)
    .eq("is_favorite", true)
    .eq("is_archived", false)

  if (mode === "next_read") {
    query = query.is("manual_score", null)
  }

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit)

  if (error) {
    throw new Error(`Falha lendo favoritos: ${error.message}`)
  }

  return (data ?? []).map((row) => {
    const work = row as unknown as Record<string, unknown>
    const calc = (work.calculated_scores as { platform_avg?: number | null; total_votes?: number | null; predicted_score?: number | null } | null) ?? null
    const synopsis = pickPrimarySynopsis(
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
      categoryScores: buildCategoryScores(work.category_scores as RawCategoryScore[] | null),
      tags: buildTags(work.work_tags as RawTagRow[] | null),
      platformAvg: calc?.platform_avg != null ? Number(calc.platform_avg) : null,
      totalVotes: calc?.total_votes != null ? Number(calc.total_votes) : null,
      predictedScore: calc?.predicted_score != null ? Number(calc.predicted_score) : null,
      coverUrl,
      isAlreadyRated: work.manual_score != null,
    } satisfies FavoriteCandidate
  })
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
  mode: "next_read" | "full_analysis"
  taste_profile_id: string | null
  user_context: string | null
  n_candidates: number
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
  mode: "next_read" | "full_analysis"
  userContext: string | null
  nCandidates: number
  topTitles: string[]
  topAlignment: number | null
  createdAt: string
  tasteProfileId: string | null
}

export async function listRecommendationRuns(limit = 50): Promise<RecommendationRunSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select(
      "id, mode, taste_profile_id, user_context, n_candidates, results, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[recommendations] erro listando runs:", error)
    return []
  }

  const rows = (data ?? []) as Array<Pick<RawRunRow, "id" | "mode" | "taste_profile_id" | "user_context" | "n_candidates" | "results" | "created_at">>
  const topWorkIds = new Set<string>()
  const perRunTop: Array<{ runId: string; ids: string[]; alignment: number | null }> = []
  for (const row of rows) {
    const arr = Array.isArray(row.results)
      ? (row.results as Array<{ work_id?: string; alignment_score?: number }>)
      : []
    const sorted = [...arr].sort((a, b) => (b.alignment_score ?? 0) - (a.alignment_score ?? 0))
    const top = sorted.slice(0, 3)
    for (const t of top) if (t.work_id) topWorkIds.add(t.work_id)
    perRunTop.push({
      runId: row.id,
      ids: top.map((t) => t.work_id ?? "").filter(Boolean),
      alignment: sorted[0]?.alignment_score ?? null,
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
      mode: row.mode,
      userContext: row.user_context,
      nCandidates: row.n_candidates,
      topTitles,
      topAlignment: meta?.alignment ?? null,
      createdAt: row.created_at,
      tasteProfileId: row.taste_profile_id,
    } satisfies RecommendationRunSummary
  })
}

export interface RecommendationRunWithWorks {
  id: string
  mode: "next_read" | "full_analysis"
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

export async function getRecommendationRun(id: string): Promise<RecommendationRunWithWorks | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("*, mode_summary")
    .eq("id", id)
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
    for (const row of worksData ?? []) {
      const work = row as unknown as Record<string, unknown>
      const calc = (work.calculated_scores as { platform_avg?: number | null; total_votes?: number | null; predicted_score?: number | null } | null) ?? null
      const synopsis = pickPrimarySynopsis(
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
      worksById.set(work.id as string, {
        id: work.id as string,
        title: work.title as string,
        synopsis,
        categoryScores: buildCategoryScores(work.category_scores as RawCategoryScore[] | null),
        tags: buildTags(work.work_tags as RawTagRow[] | null),
        platformAvg: calc?.platform_avg != null ? Number(calc.platform_avg) : null,
        totalVotes: calc?.total_votes != null ? Number(calc.total_votes) : null,
        predictedScore: calc?.predicted_score != null ? Number(calc.predicted_score) : null,
        coverUrl,
        isAlreadyRated: work.manual_score != null,
      } satisfies FavoriteCandidate)
    }
  }

  const ranked = rankings
    .filter((r) => typeof r.work_id === "string" && typeof r.alignment_score === "number")
    .sort((a, b) => (b.alignment_score ?? 0) - (a.alignment_score ?? 0))
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
    ranked,
  }
}
