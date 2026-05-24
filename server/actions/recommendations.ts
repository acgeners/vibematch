"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTasteProfile, rankFavorites, MODEL, PROMPT_VERSION } from "@/lib/ai-recommendation/service"
import { type RankingFilters } from "@/server/queries/ranking"
import {
  buildStubProfile,
  computeInputHash,
  insertNewTasteProfile,
  loadCurrentTasteProfile,
  MIN_WORKS_FOR_ANY_PROFILE,
  MIN_WORKS_FOR_FULL_PROFILE,
} from "@/lib/ai-recommendation/taste-profile"
import {
  getCandidateById,
  getFavoriteCandidates,
  getRankingCandidates,
  getRatedWorksForProfile,
  getRunsToday,
  type FavoriteCandidate,
} from "@/server/queries/recommendations"
import { MAX_CANDIDATES_HARD_LIMIT } from "@/lib/ai-recommendation/limits"
import type {
  RankedCandidate,
  RecommendationMode,
  TasteProfileRow,
} from "@/lib/ai-recommendation/types"

const MAX_RUNS_PER_DAY = 20

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
  /** Quantos candidatos rankear. Default 20, max 30. */
  n?: number
  /** Filtros aplicados na /ranking. Obrigatório quando mode = "ranking". */
  filters?: RankingFilters
}

export interface RunRecommendationResult {
  runId: string
  profile: TasteProfileRow
  modeSummary: string
  ranked: RankedCandidate[]
  candidatesEvaluated: number
  candidatesAvailable: number
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

    const n = Math.min(Math.max(args.n ?? 20, 1), MAX_CANDIDATES_HARD_LIMIT)

    const profileResult = await ensureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile

    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com manual_score pra desbloquear o ranking IA.",
      }
    }

    // Busca o universo completo primeiro (sem aplicar `n`) pra reportar
    // truncagem na UI; depois slice. Para ranking, getRanking sem topN
    // retorna a base inteira filtrada.
    let allCandidates: FavoriteCandidate[]
    if (args.mode === "ranking") {
      if (!args.filters) {
        return { error: "Filtros do ranking são obrigatórios pra rodar nesse modo." }
      }
      allCandidates = await getRankingCandidates(args.filters, 200)
    } else {
      allCandidates = await getFavoriteCandidates(args.mode, 200)
    }

    if (allCandidates.length === 0) {
      return {
        error:
          args.mode === "next_read"
            ? "Nenhum favorito sem manual_score encontrado. Marque alguns títulos como favoritos ou desfaça suas notas pra ver opções aqui."
            : args.mode === "full_analysis"
              ? "Nenhum favorito encontrado. Marque títulos como favoritos pra rankeá-los."
              : "Nenhuma obra encontrada com os filtros aplicados no ranking.",
      }
    }

    const truncated = allCandidates.length > n
    const candidates = truncated ? allCandidates.slice(0, n) : allCandidates

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
        n_available: allCandidates.length,
        source_meta: args.mode === "ranking" ? { filters: args.filters ?? null } : null,
        candidate_work_ids: candidates.map((c) => c.id),
        results: result.rankings,
        mode_summary: result.modeSummary,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        ai_api_call_id: result.apiCallId,
      })
      .select("id")
      .single()

    if (insertError || !runRow) {
      console.error("[recommendations] falha persistindo run:", insertError)
    }

    // No modo "ranking", persiste o alignment_score em calculated_scores pra
    // a coluna ficar disponível como ordenação na /ranking.
    if (args.mode === "ranking" && runRow?.id) {
      const now = new Date().toISOString()
      const upsertRows = ranked.map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: runRow.id,
        alignment_justification: r.justification,
        alignment_at: now,
      }))
      if (upsertRows.length > 0) {
        const { error: upErr } = await supabase
          .from("calculated_scores")
          .upsert(upsertRows, { onConflict: "work_id" })
        if (upErr) {
          console.error("[recommendations] falha persistindo alignment_score:", upErr)
        }
      }
      revalidatePath("/ranking")
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
        candidatesAvailable: allCandidates.length,
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

// (rerankTopNAction legacy removido — runRecommendationAction(mode: "ranking")
// cobre o mesmo caso de uso com prompt enriquecido + reviews + UI unificada.)

export interface RerankSingleWorkResult {
  alignmentScore: number
  justification: string
}

/**
 * Re-rank sob demanda de UMA obra específica. Disparado pelo botão "Rankear"
 * que substitui o "—" na cell IA Rk quando `alignment_score` é NULL.
 *
 * Compartilha o limite diário com `runRecommendationAction` (cada chamada é 1
 * LLM call). Não cria registro em `recommendation_runs` — só faz o upsert em
 * `calculated_scores` (com `alignment_run_id = NULL`).
 */
export async function rerankSingleWorkAction(
  workId: string,
): Promise<{ data?: RerankSingleWorkResult; error?: string }> {
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

    const candidate = await getCandidateById(workId)
    if (!candidate) {
      return { error: "Obra não encontrada (ou arquivada)." }
    }

    const result = await rankFavorites({
      profile: profile.profile,
      candidates: [candidate],
      mode: "ranking",
      userContext: null,
    })

    const ranking = result.rankings.find((r) => r.work_id === workId) ?? result.rankings[0]
    if (!ranking) {
      return { error: "O modelo não retornou ranking pra esta obra." }
    }

    const supabase = createAdminClient()
    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from("calculated_scores")
      .upsert(
        {
          work_id: workId,
          alignment_score: ranking.alignment_score,
          alignment_run_id: null,
          alignment_justification: ranking.justification,
          alignment_at: now,
        },
        { onConflict: "work_id" },
      )
    if (upErr) {
      return { error: `Falha persistindo alignment_score: ${upErr.message}` }
    }

    revalidatePath("/favorites")
    revalidatePath("/ranking")

    return {
      data: {
        alignmentScore: ranking.alignment_score,
        justification: ranking.justification,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}
