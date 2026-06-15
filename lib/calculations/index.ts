import { calculateGPT, normalizeGPT } from "./gpt"
import { calculatePlatformAvg, sumVotes, computeGlobalPlatformMean } from "./platform"
import { normalizeChapters } from "./chapters"
import { calculateNotaCalc } from "./score"
import type {
  CalculationInputs,
  CalculationResult,
} from "@/types/domain"

export {
  calculateGPT,
  normalizeGPT,
  calculatePlatformAvg,
  sumVotes,
  computeGlobalPlatformMean,
  normalizeChapters,
  calculateNotaCalc,
}

/**
 * Orquestrador principal: recebe todos os dados de uma obra
 * e retorna o resultado completo do cálculo.
 *
 * predictedScore (Nota.Pr) deve ser fornecido externamente
 * (do ML ou do KNN similarity). Se null, finalScore será null.
 */
export function calculateAll(inputs: CalculationInputs): CalculationResult {
  const {
    categoryScores,
    weights,
    platformRatings,
    totalChapters,
    synopsisQuality,
    observationAdjustment,
    config,
    globalPlatformMean,
  } = inputs

  const iaEvalRaw = calculateGPT(categoryScores, weights)
  // Centro vindo do último recalc do catálogo (fallback 5 antes do 1º recalc).
  const iaEvalNormalized = normalizeGPT(iaEvalRaw, config.gpt_mean ?? 5)

  const totalVotes = sumVotes(platformRatings)
  const platformAvg = calculatePlatformAvg(
    platformRatings,
    globalPlatformMean,
    config.pseudo_votes_nota_m
  )

  const chaptersNormalized = normalizeChapters(totalChapters)

  const calcScore = calculateNotaCalc({
    iaEvalNormalized,
    platformAvg,
    totalVotes,
    synopsisQuality,
    observationAdjustment,
    pseudoVotesBlend: config.pseudo_votes_blend,
  })

  return {
    iaEvalRaw,
    iaEvalNormalized,
    totalVotes,
    platformAvg,
    chaptersNormalized,
    calcScore,
    predictedScore: null,
    predictedIsStub: true,
    finalScore: null,
  }
}

export type { CalculationInputs, CalculationResult }
