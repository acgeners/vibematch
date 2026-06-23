import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
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
    // Assinatura de CONTEÚDO do perfil (não o input_hash da biblioteca) — chave
    // de staleness: só invalida quando o gosto destilado realmente muda.
    tasteProfileHash: computeProfileSignature(profile.profile),
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
 * canônica. Roteado pela orquestração durável (Fase B passo 4): background =
 * `isBackground` ⇒ só prevê quando o perfil está FRESH (nunca gera/atualiza
 * perfil — evita custo surpresa no save/import) e quando a assinatura mudou.
 * Job durável + dedup + readiness por assinatura. Engole erros (acessório ao save).
 */
export async function autoPredictSynopsisQuality(workId: string): Promise<void> {
  try {
    const { ensurePredictInterest, SupabaseInterestGateway } = await import(
      "@/lib/orchestration/integrations/synopsis-interest"
    )
    await ensurePredictInterest(workId, { isBackground: true, gateway: new SupabaseInterestGateway() })
  } catch (err) {
    console.error("[synopsis-quality] auto-predict falhou:", err)
  }
}
