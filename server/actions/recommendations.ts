"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTasteProfile, rankFavorites, MODEL, PROMPT_VERSION } from "@/lib/ai-recommendation/service"
import { rankCandidates } from "@/lib/ai-recommendation/llm-reranker"
import { getRanking, type RankingFilters } from "@/server/queries/ranking"
import type { CriterionSlug } from "@/types/domain"
import {
  buildStubProfile,
  computeInputHash,
  insertNewTasteProfile,
  loadCurrentTasteProfile,
  MIN_WORKS_FOR_ANY_PROFILE,
  MIN_WORKS_FOR_FULL_PROFILE,
} from "@/lib/ai-recommendation/taste-profile"
import {
  getFavoriteCandidates,
  getRatedWorksForProfile,
  getRunsToday,
  type FavoriteCandidate,
} from "@/server/queries/recommendations"
import type {
  RankedCandidate,
  RecommendationMode,
  TasteProfileRow,
} from "@/lib/ai-recommendation/types"

const MAX_RUNS_PER_DAY = 20
const MAX_CANDIDATES_PER_RUN = 50

export interface ProfileStatus {
  hasProfile: boolean
  profile: TasteProfileRow | null
  isStale: boolean
  currentHash: string
  ratedWorksCount: number
}

export async function getTasteProfileStatusAction(): Promise<ProfileStatus> {
  const [profile, ratedWorks] = await Promise.all([
    loadCurrentTasteProfile(),
    getRatedWorksForProfile(),
  ])
  const currentHash = computeInputHash(ratedWorks)
  return {
    hasProfile: profile != null,
    profile,
    isStale: profile != null && profile.input_hash !== currentHash,
    currentHash,
    ratedWorksCount: ratedWorks.length,
  }
}

export async function generateTasteProfileAction(): Promise<{
  data?: TasteProfileRow
  error?: string
}> {
  try {
    const ratedWorks = await getRatedWorksForProfile()
    const inputHash = computeInputHash(ratedWorks)

    if (ratedWorks.length < MIN_WORKS_FOR_FULL_PROFILE) {
      const stub = buildStubProfile(ratedWorks.length)
      const saved = await insertNewTasteProfile({
        profile: stub,
        nWorks: ratedWorks.length,
        inputHash,
        isStub: true,
        modelName: MODEL,
        promptVersion: PROMPT_VERSION,
        rawResponse: null,
      })
      return { data: saved }
    }

    const result = await generateTasteProfile(ratedWorks)
    const saved = await insertNewTasteProfile({
      profile: result.profile,
      nWorks: ratedWorks.length,
      inputHash,
      isStub: false,
      modelName: result.modelName,
      promptVersion: result.promptVersion,
      rawResponse: result.rawResponse,
    })
    return { data: saved }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

async function ensureProfile(): Promise<{ profile: TasteProfileRow; ratedWorksCount: number } | { error: string }> {
  const ratedWorks = await getRatedWorksForProfile()
  if (ratedWorks.length < MIN_WORKS_FOR_ANY_PROFILE) {
    return {
      error: `Você precisa avaliar pelo menos ${MIN_WORKS_FOR_ANY_PROFILE} obras (manual_score) pra eu identificar seu gosto. Atualmente: ${ratedWorks.length}.`,
    }
  }
  const existing = await loadCurrentTasteProfile()
  if (existing) return { profile: existing, ratedWorksCount: ratedWorks.length }

  const inputHash = computeInputHash(ratedWorks)
  if (ratedWorks.length < MIN_WORKS_FOR_FULL_PROFILE) {
    const stub = buildStubProfile(ratedWorks.length)
    const saved = await insertNewTasteProfile({
      profile: stub,
      nWorks: ratedWorks.length,
      inputHash,
      isStub: true,
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      rawResponse: null,
    })
    return { profile: saved, ratedWorksCount: ratedWorks.length }
  }

  const result = await generateTasteProfile(ratedWorks)
  const saved = await insertNewTasteProfile({
    profile: result.profile,
    nWorks: ratedWorks.length,
    inputHash,
    isStub: false,
    modelName: result.modelName,
    promptVersion: result.promptVersion,
    rawResponse: result.rawResponse,
  })
  return { profile: saved, ratedWorksCount: ratedWorks.length }
}

export interface RunRecommendationArgs {
  mode: RecommendationMode
  userContext?: string | null
}

export interface RunRecommendationResult {
  runId: string
  profile: TasteProfileRow
  modeSummary: string
  ranked: RankedCandidate[]
  candidatesEvaluated: number
  truncated: boolean
  modelName: string
  promptVersion: string
}

export async function runRecommendationAction(
  args: RunRecommendationArgs,
): Promise<{ data?: RunRecommendationResult; error?: string }> {
  try {
    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await ensureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile

    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com manual_score pra desbloquear o ranking IA.",
      }
    }

    const allCandidates = await getFavoriteCandidates(args.mode, 200)
    if (allCandidates.length === 0) {
      return {
        error:
          args.mode === "next_read"
            ? "Nenhum favorito sem manual_score encontrado. Marque alguns títulos como favoritos ou desfaça suas notas pra ver opções aqui."
            : "Nenhum favorito encontrado. Marque títulos como favoritos pra rankeá-los.",
      }
    }

    const truncated = allCandidates.length > MAX_CANDIDATES_PER_RUN
    const candidates = truncated
      ? allCandidates.slice(0, MAX_CANDIDATES_PER_RUN)
      : allCandidates

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: args.mode,
      userContext: args.userContext ?? null,
    })

    const byId = new Map<string, FavoriteCandidate>(candidates.map((c) => [c.id, c]))
    const ranked: RankedCandidate[] = []
    for (const r of result.rankings) {
      const work = byId.get(r.work_id)
      if (!work) continue
      ranked.push({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        justification: r.justification,
        top_match_factors: r.top_match_factors,
        work,
        coverUrl: work.coverUrl,
      })
    }

    const supabase = createAdminClient()
    const { data: runRow, error: insertError } = await supabase
      .from("recommendation_runs")
      .insert({
        mode: args.mode,
        taste_profile_id: profile.id,
        user_context: args.userContext?.trim() || null,
        n_candidates: candidates.length,
        candidate_work_ids: candidates.map((c) => c.id),
        results: result.rankings,
        mode_summary: result.modeSummary,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
      })
      .select("id")
      .single()

    if (insertError || !runRow) {
      console.error("[recommendations] falha persistindo run:", insertError)
    }

    revalidatePath("/recommendations")
    if (runRow?.id) revalidatePath(`/recommendations/${runRow.id}`)

    return {
      data: {
        runId: (runRow?.id as string) ?? "unsaved",
        profile,
        modeSummary: result.modeSummary,
        ranked,
        candidatesEvaluated: candidates.length,
        truncated,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export async function deleteRecommendationRunAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.from("recommendation_runs").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/recommendations")
  return { ok: true }
}

export async function rerunRecommendationFromExistingAction(
  id: string,
): Promise<{ data?: RunRecommendationResult; error?: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("mode, user_context")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return { error: error?.message ?? "Run original não encontrada." }
  return runRecommendationAction({
    mode: data.mode as RecommendationMode,
    userContext: (data.user_context as string | null) ?? null,
  })
}

// ============================================================
// Passo 8 — LLM re-ranker generalizado
// ============================================================

const MAX_RERANK_CANDIDATES = 50

export interface RerankTopNArgs {
  filters: RankingFilters
  /** Quantos candidatos top-N pegar do ranking pra rankear via LLM. Max 50. */
  limit?: number
  /** Descrição livre do contexto (ex: "drama + completed"). Aparece no prompt. */
  modeLabel?: string
  userContext?: string | null
}

export interface RerankTopNResultEntry {
  workId: string
  title: string
  coverUrl: string | null
  alignmentScore: number
  justification: string
  topMatchFactors: string[]
  /** Posição original no ranking determinístico (antes do LLM re-rank). */
  originalRank: number
  /** Final.Score (informativo, pra ver o "antes vs depois"). */
  finalScore: number | null
  manualScore: number | null
}

export interface RerankTopNResult {
  runId: string
  modeSummary: string
  modelName: string
  promptVersion: string
  entries: RerankTopNResultEntry[]
}

/**
 * Rankeia via LLM os top-N da página /ranking aplicando os filtros recebidos.
 * Persiste `alignment_score` em `calculated_scores` pra cada obra rankeada —
 * a coluna fica disponível em `/ranking` como sort option mesmo depois.
 */
export async function rerankTopNAction(
  args: RerankTopNArgs,
): Promise<{ data?: RerankTopNResult; error?: string }> {
  try {
    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções IA atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await ensureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    if (profileResult.profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com manual_score pra desbloquear ranking IA.",
      }
    }
    const profile = profileResult.profile

    // Pega top-N do ranking com os filtros fornecidos
    const limit = Math.min(args.limit ?? MAX_RERANK_CANDIDATES, MAX_RERANK_CANDIDATES)
    const entries = await getRanking({ ...args.filters, topN: limit })
    if (entries.length === 0) {
      return {
        error: "Nenhuma obra encontrada com os filtros aplicados pra rankear.",
      }
    }

    // Converte RankingEntry → CandidateWorkInput
    const candidates = entries.map((e) => ({
      id: e.workId,
      title: e.title,
      synopsis: e.synopsis,
      categoryScores: e.scores as Partial<Record<CriterionSlug, number>>,
      tags: e.tags.map((t) => ({ name: t.name, group: t.tag_group_id })),
      platformAvg: e.platformAvg,
      totalVotes: e.totalVotes,
      predictedScore: e.predictedScore,
    }))

    const modeLabel = args.modeLabel
      ? `Subset filtrado em /ranking: ${args.modeLabel} (top-${entries.length}).`
      : `Top-${entries.length} obras filtradas em /ranking. Rankeie cada uma pelo alinhamento com o perfil.`

    const result = await rankCandidates({
      profile: profile.profile,
      candidates,
      modeLabel,
      userContext: args.userContext ?? null,
    })

    const supabase = createAdminClient()
    const { data: runRow, error: insertError } = await supabase
      .from("recommendation_runs")
      .insert({
        mode: "full_analysis",
        taste_profile_id: profile.id,
        user_context: args.userContext?.trim() || args.modeLabel || null,
        n_candidates: candidates.length,
        candidate_work_ids: candidates.map((c) => c.id),
        results: result.rankings,
        mode_summary: result.modeSummary,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
      })
      .select("id")
      .single()

    if (insertError || !runRow) {
      console.error("[rerankTopN] falha persistindo run:", insertError)
    }
    const runId = (runRow?.id as string) ?? null

    // Persiste alignment_score por obra em calculated_scores (upsert seletivo)
    const now = new Date().toISOString()
    const rankingByWorkId = new Map(result.rankings.map((r) => [r.work_id, r]))
    const upsertRows = entries
      .map((e) => {
        const r = rankingByWorkId.get(e.workId)
        if (!r) return null
        return {
          work_id: e.workId,
          alignment_score: r.alignment_score,
          alignment_run_id: runId,
          alignment_justification: r.justification,
          alignment_at: now,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (upsertRows.length > 0) {
      const { error: upErr } = await supabase
        .from("calculated_scores")
        .upsert(upsertRows, { onConflict: "work_id" })
      if (upErr) {
        console.error("[rerankTopN] falha atualizando alignment_score:", upErr)
      }
    }

    revalidatePath("/ranking")
    revalidatePath("/recommendations")

    const entryById = new Map(entries.map((e) => [e.workId, e]))
    const ranked: RerankTopNResultEntry[] = result.rankings.map((r) => {
      const e = entryById.get(r.work_id)
      return {
        workId: r.work_id,
        title: e?.title ?? "(removida)",
        coverUrl: e?.coverUrl ?? null,
        alignmentScore: r.alignment_score,
        justification: r.justification,
        topMatchFactors: r.top_match_factors,
        originalRank: e?.rank ?? -1,
        finalScore: e?.finalScore ?? null,
        manualScore: e?.manualScore ?? null,
      }
    })

    return {
      data: {
        runId: runId ?? "unsaved",
        modeSummary: result.modeSummary,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        entries: ranked,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
