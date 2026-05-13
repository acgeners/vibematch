import type { ScoreWeight, CategoryScoreMap } from "@/types/domain"

/**
 * GPT = soma ponderada das categorias / soma dos pesos positivos
 *
 * Critérios negativos (Drama, Tragédia) só contribuem quando o score
 * supera o max_negative_threshold. A divisão é sempre pela soma
 * dos pesos POSITIVOS (56 por default).
 */
export function calculateGPT(
  scores: CategoryScoreMap,
  weights: ScoreWeight[]
): number {
  const activeWeights = weights.filter((w) => w.is_active)

  const positiveWeightSum = activeWeights
    .filter((w) => w.weight > 0)
    .reduce((acc, w) => acc + w.weight, 0)

  if (positiveWeightSum === 0) return 0

  const numerator = activeWeights.reduce((acc, w) => {
    const score = scores[w.slug] ?? 0
    if (w.weight < 0) {
      const threshold = w.max_negative_threshold ?? 0
      const excess = Math.max(0, score - threshold)
      return acc + excess * w.weight
    }
    return acc + score * w.weight
  }, 0)

  return Math.max(0, Math.min(10, numerator / positiveWeightSum))
}

/**
 * GPT.N = MAX(0, MIN(10, 5 + (GPT - 5) * 1.25))
 * Amplifica a diferença em relação à média (5), expandindo a escala.
 */
export function normalizeGPT(gpt: number): number {
  return Math.max(0, Math.min(10, 5 + (gpt - 5) * 1.25))
}
