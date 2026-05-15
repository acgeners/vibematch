import type { ScoreWeight, CategoryScoreMap } from "@/types/domain"

/**
 * GPT = soma ponderada das categorias / soma dos pesos positivos
 *
 * O campo `threshold` aplica-se a critérios positivos e negativos:
 *   - Critério negativo (Drama, Tragédia): score abaixo do threshold não
 *     penaliza; apenas o excedente é multiplicado pelo peso (negativo).
 *   - Critério positivo (Romance, Ação, …): contribui normalmente até o
 *     threshold e ganha bônus dobrado para cada ponto acima dele.
 *
 * Denominador segue sendo a soma dos pesos POSITIVOS. O clamp 0–10
 * absorve qualquer excedente vindo do bônus.
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
    const threshold = w.threshold ?? 0
    const excess = Math.max(0, score - threshold)
    if (w.weight < 0) {
      return acc + excess * w.weight
    }
    return acc + score * w.weight + excess * w.weight
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
