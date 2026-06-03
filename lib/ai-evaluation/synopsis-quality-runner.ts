import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { getCandidateById } from "@/server/queries/recommendations"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { upsertSynopsisPrediction } from "@/server/queries/synopsis-quality"
import { predictSynopsisQuality, type PredictWorkInput } from "./synopsis-quality-predictor"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"
import type { SynopsisQuality } from "@/types/domain"

export interface RunPredictionResult {
  predictedQuality: SynopsisQuality
  justification: string
  confidence: number | null
}

/**
 * Estima o Interesse Sinopse de uma obra com um perfil JÁ carregado e persiste
 * a previsão. Compartilhado entre a action por-obra, o lote e o auto-trigger.
 * `client` opcional mantém o cache do bloco de perfil quente entre chamadas do
 * lote.
 */
export async function predictAndPersistSynopsisQuality(
  profile: TasteProfileRow,
  work: PredictWorkInput,
  client?: Anthropic,
): Promise<RunPredictionResult> {
  const prediction = await predictSynopsisQuality({ profile: profile.profile, work, client })
  const up = await upsertSynopsisPrediction({
    workId: work.id,
    predictedQuality: prediction.predictedQuality,
    justification: prediction.justification,
    confidence: prediction.confidence,
    tasteProfileId: profile.id,
    tasteProfileVersion: profile.version,
    tasteProfileHash: profile.input_hash,
    modelName: prediction.modelName,
    promptVersion: prediction.promptVersion,
    aiApiCallId: prediction.apiCallId,
  })
  if (up.error) throw new Error(`Falha persistindo previsão: ${up.error}`)
  return {
    predictedQuality: prediction.predictedQuality,
    justification: prediction.justification,
    confidence: prediction.confidence,
  }
}

/**
 * Auto-trigger (best-effort) chamado quando uma obra ganha/atualiza a sinopse
 * canônica. SÓ roda quando já existe um perfil de gosto corrente NÃO-stub —
 * nunca gera um perfil LLM aqui (evita custo surpresa no fluxo de save/import).
 * Engole erros: a previsão é acessória ao salvamento da obra.
 */
export async function autoPredictSynopsisQuality(workId: string): Promise<void> {
  try {
    const profile = await loadCurrentTasteProfile()
    if (!profile || profile.is_stub) return
    const candidate = await getCandidateById(workId)
    if (!candidate || !candidate.synopsis) return
    await predictAndPersistSynopsisQuality(profile, candidate)
  } catch (err) {
    console.error("[synopsis-quality] auto-predict falhou:", err)
  }
}
