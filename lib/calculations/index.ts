import { calculateGPT, normalizeGPT } from "./gpt"
import { calculatePlatformAvg, sumVotes, computeGlobalPlatformMean } from "./platform"
import { normalizeChapters } from "./chapters"
import { calculateNotaCalc } from "./score"
import { calculateNotaFinal } from "./final"
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
  calculateNotaFinal,
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
    publicationStatus,
    synopsisQuality,
    observationAdjustment,
    config,
    globalPlatformMean,
  } = inputs

  const iaEvalRaw = calculateGPT(categoryScores, weights)
  const iaEvalNormalized = normalizeGPT(iaEvalRaw)

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
    chaptersNormalized,
    publicationStatus,
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

/**
 * Versão completa com Nota.Pr disponível.
 */
export function calculateAllWithPrediction(
  inputs: CalculationInputs,
  predictedScore: number,
  predictedIsStub: boolean
): CalculationResult {
  const partial = calculateAll(inputs)
  const finalScore = calculateNotaFinal(
    partial.calcScore,
    predictedScore,
    inputs.config.mae_calc,
    inputs.config.mae_predicted
  )
  return {
    ...partial,
    predictedScore,
    predictedIsStub,
    finalScore,
  }
}

export type { CalculationInputs, CalculationResult }
