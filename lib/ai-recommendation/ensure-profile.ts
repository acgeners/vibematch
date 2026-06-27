import "server-only"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import { recordCacheEventAsync } from "@/server/queries/ai-cache"
import { MODEL, PROMPT_VERSION } from "./service"
import { ensureTasteProfile } from "@/lib/orchestration/integrations/taste-profile"
import {
  buildStubProfile,
  computeInputHash,
  insertNewTasteProfile,
  loadCurrentTasteProfile,
  MIN_WORKS_FOR_ANY_PROFILE,
  MIN_WORKS_FOR_FULL_PROFILE,
} from "./taste-profile"
import type { TasteProfileRow } from "./types"

export interface LoadProfileOptions {
  /**
   * Quando true, regenera o perfil (LLM) se ele estiver DESATUALIZADO em relação
   * às obras avaliadas atuais (input_hash diferente) — ou se ainda for um stub
   * mas já houver obras suficientes pra um perfil completo. Default false:
   * carrega o perfil atual como está (comportamento dos fluxos legados).
   */
  refreshIfStale?: boolean
}

export type EnsureProfileResult =
  | { profile: TasteProfileRow; ratedWorksCount: number; staleRefresh: boolean }
  | { error: string }

async function regenerateFullProfile(
  ratedWorks: Awaited<ReturnType<typeof getRatedWorksForProfile>>,
  inputHash: string,
): Promise<TasteProfileRow> {
  // Geração roteada pela orquestração durável (Fase B passo 3): job durável,
  // dedup cross-processo + single-flight, status, falha persistida e retomada.
  // É uma AÇÃO PAGA já iniciada pelo usuário (recomendação/chat passaram pelo gate
  // de capability) ⇒ allowPaid:true (uma confirmação), preservando o auto-run de
  // hoje. Efeitos da criação (nova versão, anterior deixa de ser atual, previsões
  // de Interesse marcadas stale) ficam intactos dentro de insertNewTasteProfile.
  // onWaiter preserva a telemetria de dedup in-process (recordCacheEventAsync).
  const outcome = await ensureTasteProfile({
    allowPaid: true,
    refreshIfStale: true,
    ratedWorks,
    onWaiter: () =>
      recordCacheEventAsync({
        operation: "recommendation_taste_profile",
        workloadType: "recurring",
        cacheLayer: "memory",
        cacheStatus: "hit_memory",
        cacheMissReason: "single_flight_dedup",
        inputHash,
        modelName: MODEL,
        promptVersion: PROMPT_VERSION,
      }),
  })
  if (outcome.status === "succeeded" || outcome.status === "fresh" || outcome.status === "stale") {
    return outcome.profile
  }
  if (outcome.status === "failed") throw new Error(outcome.error)
  // blocked_manual/blocked_cost_confirmation/processing não devem ocorrer aqui:
  // o caller garante ≥10 obras e allowPaid:true; single-flight cobre concorrência
  // in-process. Erro coerente caso a invariante quebre.
  throw new Error(`Geração de perfil indisponível (status: ${outcome.status}).`)
}

/**
 * Carrega o TasteProfile atual ou gera um na hora quando ainda não existe.
 * Compartilhado entre `runRecommendationAction` / re-ranks e o chat de
 * recomendação pra não duplicar a lógica de stub/LLM. Os callers já estão
 * atrás do gate Pago (`smart_shortlist`/`chat_recommend`), então quando há
 * obras suficientes e nenhum perfil salvo (ou um perfil stale + refreshIfStale),
 * gera o perfil LLM rico.
 *
 * `staleRefresh` indica que um perfil PRÉ-EXISTENTE foi substituído por estar
 * desatualizado (vs. primeira geração) — o chat usa isso pra avisar o usuário.
 */
export async function loadOrEnsureProfile(
  opts: LoadProfileOptions = {},
): Promise<EnsureProfileResult> {
  const ratedWorks = await getRatedWorksForProfile()
  if (ratedWorks.length < MIN_WORKS_FOR_ANY_PROFILE) {
    return {
      error: `Você precisa avaliar pelo menos ${MIN_WORKS_FOR_ANY_PROFILE} obras (user_score) pra eu identificar seu gosto. Atualmente: ${ratedWorks.length}.`,
    }
  }

  const inputHash = computeInputHash(ratedWorks)
  const existing = await loadCurrentTasteProfile()

  if (existing) {
    const canRegen = !!opts.refreshIfStale && ratedWorks.length >= MIN_WORKS_FOR_FULL_PROFILE
    const isStale = existing.input_hash !== inputHash
    if (canRegen && (existing.is_stub || isStale)) {
      const saved = await regenerateFullProfile(ratedWorks, inputHash)
      return { profile: saved, ratedWorksCount: ratedWorks.length, staleRefresh: true }
    }
    return { profile: existing, ratedWorksCount: ratedWorks.length, staleRefresh: false }
  }

  // Sem perfil ainda — primeira geração (não conta como staleRefresh).
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
      ratedWorks,
    })
    return { profile: saved, ratedWorksCount: ratedWorks.length, staleRefresh: false }
  }

  const saved = await regenerateFullProfile(ratedWorks, inputHash)
  return { profile: saved, ratedWorksCount: ratedWorks.length, staleRefresh: false }
}
