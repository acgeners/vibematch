import "server-only"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import { generateTasteProfile, MODEL, PROMPT_VERSION } from "./service"
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
  const result = await generateTasteProfile(ratedWorks)
  return insertNewTasteProfile({
    profile: result.profile,
    nWorks: ratedWorks.length,
    inputHash,
    isStub: false,
    modelName: result.modelName,
    promptVersion: result.promptVersion,
    rawResponse: result.rawResponse,
  })
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
    })
    return { profile: saved, ratedWorksCount: ratedWorks.length, staleRefresh: false }
  }

  const saved = await regenerateFullProfile(ratedWorks, inputHash)
  return { profile: saved, ratedWorksCount: ratedWorks.length, staleRefresh: false }
}
