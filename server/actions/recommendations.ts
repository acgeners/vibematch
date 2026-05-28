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
  RankedWork,
  RecommendationMode,
  TasteProfileRow,
} from "@/lib/ai-recommendation/types"

const MAX_RUNS_PER_DAY = 20

/**
 * Extrai apenas os campos enriquecidos (sub-fase 2.3.A) pra persistir em
 * `calculated_scores.alignment_payload`. Retorna NULL quando nenhum dos
 * campos opcionais foi preenchido pelo modelo — evita upsert de JSONB vazio.
 */
function buildAlignmentPayload(r: RankedWork): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {}
  if (r.confidence != null) payload.confidence = r.confidence
  if (r.risks && r.risks.length > 0) payload.risks = r.risks
  if (r.similar_loved && r.similar_loved.length > 0) payload.similar_loved = r.similar_loved
  if (r.similar_avoided && r.similar_avoided.length > 0) payload.similar_avoided = r.similar_avoided
  if (r.review_quotes && r.review_quotes.length > 0) payload.review_quotes = r.review_quotes
  if (r.mood_fit != null) payload.mood_fit = r.mood_fit
  return Object.keys(payload).length > 0 ? payload : null
}

// Gera slug único no formato YYYY-MM-DD-N. Tenta computar N olhando o máximo do
// dia e re-tenta em colisão (race entre runs simultâneas — raro, mas garante a
// unique constraint do índice).
async function generateRunSlug(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await supabase
    .from("recommendation_runs")
    .select("slug")
    .like("slug", `${today}-%`)
  const maxN = (existing ?? []).reduce((max, row) => {
    const slug = (row.slug as string | null) ?? ""
    const n = parseInt(slug.slice(today.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${today}-${maxN + 1}`
}

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
  runSlug: string
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
        confidence: r.confidence ?? null,
        risks: r.risks ?? undefined,
        similar_loved: r.similar_loved ?? undefined,
        similar_avoided: r.similar_avoided ?? undefined,
        review_quotes: r.review_quotes ?? undefined,
        mood_fit: r.mood_fit ?? null,
        work,
        coverUrl: work.coverUrl,
      })
    }

    const supabase = createAdminClient()
    const baseInsert = {
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
    }

    let runRow: { id: string; slug: string } | null = null
    let insertError: { code?: string; message: string } | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = await generateRunSlug(supabase)
      const { data, error } = await supabase
        .from("recommendation_runs")
        .insert({ ...baseInsert, slug })
        .select("id, slug")
        .single()
      if (!error && data) {
        runRow = { id: data.id as string, slug: data.slug as string }
        insertError = null
        break
      }
      insertError = error
      if (error?.code !== "23505") break
    }

    if (insertError || !runRow) {
      console.error("[recommendations] falha persistindo run:", insertError)
    }

    // Persiste alignment_score em calculated_scores pra a coluna "IA Rk." ficar
    // disponível em qualquer tabela (ranking, favoritos, títulos) — independente
    // do modo da run, já que sempre representa o re-rank mais recente da obra.
    // alignment_payload guarda os campos enriquecidos (sub-fase 2.3.A) — pode
    // ficar NULL se o modelo não preencheu nenhum opcional.
    if (runRow?.id) {
      const now = new Date().toISOString()
      const upsertRows = ranked.map((r) => {
        const payload = buildAlignmentPayload(r)
        return {
          work_id: r.work_id,
          alignment_score: r.alignment_score,
          alignment_run_id: runRow.id,
          alignment_justification: r.justification,
          alignment_payload: payload,
          alignment_at: now,
        }
      })
      if (upsertRows.length > 0) {
        const { error: upErr } = await supabase
          .from("calculated_scores")
          .upsert(upsertRows, { onConflict: "work_id" })
        if (upErr) {
          console.error("[recommendations] falha persistindo alignment_score:", upErr)
        }
      }
      revalidatePath("/ranking")
      revalidatePath("/favorites")
      revalidatePath("/titles")
    }

    revalidatePath("/recommendations")
    if (runRow?.slug) revalidatePath(`/recommendations/${runRow.slug}`)

    return {
      data: {
        runId: runRow?.id ?? "unsaved",
        runSlug: runRow?.slug ?? "unsaved",
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
          alignment_payload: buildAlignmentPayload(ranking),
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
