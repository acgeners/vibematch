"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { runDeepDive } from "@/lib/ai-recommendation/deep-dive"
import { MAX_DEEP_DIVES_PER_DAY } from "@/lib/ai-recommendation/deep-dive-limits"
import { ensureAiConsumption } from "@/server/queries/ai-quota"
import { getSessionUserId } from "@/server/queries/current-user"
import {
  getDeepDiveById,
  getDeepDiveContext,
  getDeepDiveHistory,
  getDeepDivesToday,
  getLastDeepDive,
} from "@/server/queries/deep-dive"
import { getPreferenceRules } from "@/server/queries/preference-rules"
import type { DeepDiveResultRow } from "@/lib/ai-recommendation/types"

// Tipos auxiliares ficam inline pra cumprir a regra do Next "use server":
// só async functions podem ser exportadas. Constantes ficam em
// lib/ai-recommendation/deep-dive-limits.ts.
type DeepDiveActionResult = {
  data?: DeepDiveResultRow
  error?: string
}

export async function deepDiveWorkAction(
  workId: string,
  userContext?: string | null,
): Promise<DeepDiveActionResult> {
  try {
    // Gate: Deep Dive é exclusivo do Pago.
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }

    // Dono desta ação. Depois do gate de consumo (que exige sessão), sempre há um id;
    // usamos `getSessionUserId` (não `getCurrentUserId`) de propósito: a variante que cai
    // no singleton gravaria o Deep Dive na linha do dono num POST sem sessão (current-user.ts:82).
    const userId = await getSessionUserId()
    if (!userId) return { error: "Entre na sua conta para usar o Deep Dive." }

    // Teto de frequência POR USUÁRIO (migration 159). Antes era global: um usuário
    // esgotava os Deep Dives de todos. Custo já é limitado à parte por `ensureAiConsumption`.
    const runsToday = await getDeepDivesToday(userId)
    if (runsToday >= MAX_DEEP_DIVES_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_DEEP_DIVES_PER_DAY} Deep Dives atingido. Tente novamente amanhã.`,
      }
    }

    const [ctxResult, preferenceRules] = await Promise.all([
      getDeepDiveContext(workId),
      getPreferenceRules(),
    ])
    if (ctxResult.error || !ctxResult.data) {
      return { error: ctxResult.error ?? "Falha carregando contexto do Deep Dive." }
    }

    const trimmedContext = userContext?.trim() || null
    const result = await runDeepDive({
      context: ctxResult.data.context,
      userContext: trimmedContext,
      preferenceRules,
    })

    const supabase = createAdminClient()
    const { data: inserted, error: insertErr } = await supabase
      .from("deep_dive_results")
      .insert({
        work_id: workId,
        user_id: userId,
        taste_profile_id: ctxResult.data.context.profileId,
        user_context: trimmedContext,
        payload: result.payload,
        match_score: result.payload.match_score,
        confidence: result.payload.confidence,
        read_when: result.payload.read_recommendation.when,
        one_liner: result.payload.one_liner,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        thinking_tokens: result.thinkingTokens,
        ai_api_call_id: result.apiCallId,
      })
      .select("*")
      .single()

    if (insertErr || !inserted) {
      return {
        error: `Falha persistindo Deep Dive: ${insertErr?.message ?? "erro desconhecido"}`,
      }
    }

    revalidatePath(`/titles/${workId}`)

    return {
      data: {
        id: inserted.id as string,
        work_id: inserted.work_id as string,
        taste_profile_id: (inserted.taste_profile_id as string | null) ?? null,
        user_context: (inserted.user_context as string | null) ?? null,
        payload: result.payload,
        match_score: result.payload.match_score,
        confidence: result.payload.confidence,
        read_when: result.payload.read_recommendation.when,
        one_liner: result.payload.one_liner,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        thinking_tokens: result.thinkingTokens,
        ai_api_call_id: result.apiCallId,
        created_at: inserted.created_at as string,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Action de leitura usada pelo drawer pra "abrir histórico" sem disparar
 * nova call. Mantida aqui pra centralizar o ponto de chamada via "use server".
 */
export async function getLastDeepDiveAction(workId: string): Promise<DeepDiveResultRow | null> {
  return getLastDeepDive(workId)
}

/** Lista dos últimos N deep dives da obra — usada pela seção de histórico. */
export async function listDeepDiveHistoryAction(
  workId: string,
  limit = 10,
): Promise<DeepDiveResultRow[]> {
  return getDeepDiveHistory(workId, limit)
}

/**
 * Carrega a linha completa (com `payload`) de um Deep Dive — usada pelo modal da
 * central de Deep Dives em /recommendations, que só recebe o resumo leve na lista.
 */
export async function getDeepDiveByIdAction(id: string): Promise<DeepDiveResultRow | null> {
  return getDeepDiveById(id)
}
