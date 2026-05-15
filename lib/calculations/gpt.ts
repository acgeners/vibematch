import type { ScoreWeight, CategoryScoreMap } from "@/types/domain"

/**
 * Multiplicador do bônus acima do threshold pra critérios positivos.
 * Antes era 1.0 (bônus "dobrado" — score+excess); reduzido pra 0.5 pra
 * suavizar a distorção em obras com muitos critérios altos, que estouravam
 * o teto pré-clamp e perdiam sinal.
 */
const POSITIVE_BONUS_FACTOR = 0.5

export interface GptDiagnostics {
  /** Resultado pré-clamp — se !== value, o clamp 0-10 disparou. */
  rawValue: number
  /** True quando rawValue saiu fora de [0, 10]. */
  clampHit: boolean
  /**
   * Por slug: true quando o critério negativo (drama, tragédia) contribuiu
   * com penalidade não-nula (score > threshold).
   */
  negativeActivations: Record<string, boolean>
}

/**
 * GPT = soma ponderada das categorias / soma dos pesos positivos
 *
 * O campo `threshold` aplica-se a critérios positivos e negativos:
 *   - Critério negativo (Drama, Tragédia): score abaixo do threshold não
 *     penaliza; apenas o excedente é multiplicado pelo peso (negativo).
 *   - Critério positivo (Romance, Ação, …): contribui normalmente até o
 *     threshold e ganha bônus de (POSITIVE_BONUS_FACTOR × excess) para
 *     cada ponto acima.
 *
 * Denominador segue sendo a soma dos pesos POSITIVOS. O clamp 0–10
 * absorve qualquer excedente — `clampHit` em GptDiagnostics sinaliza
 * quando isso aconteceu.
 */
export function calculateGPTWithDiagnostics(
  scores: CategoryScoreMap,
  weights: ScoreWeight[]
): { value: number; diagnostics: GptDiagnostics } {
  const activeWeights = weights.filter((w) => w.is_active)

  const positiveWeightSum = activeWeights
    .filter((w) => w.weight > 0)
    .reduce((acc, w) => acc + w.weight, 0)

  if (positiveWeightSum === 0) {
    return {
      value: 0,
      diagnostics: { rawValue: 0, clampHit: false, negativeActivations: {} },
    }
  }

  const negativeActivations: Record<string, boolean> = {}
  let numerator = 0

  for (const w of activeWeights) {
    const score = scores[w.slug] ?? 0
    const threshold = w.threshold ?? 0
    const excess = Math.max(0, score - threshold)
    if (w.weight < 0) {
      negativeActivations[w.slug] = excess > 0
      numerator += excess * w.weight
    } else {
      numerator += score * w.weight + POSITIVE_BONUS_FACTOR * excess * w.weight
    }
  }

  const rawValue = numerator / positiveWeightSum
  const clamped = Math.max(0, Math.min(10, rawValue))

  return {
    value: clamped,
    diagnostics: {
      rawValue,
      clampHit: rawValue < 0 || rawValue > 10,
      negativeActivations,
    },
  }
}

export function calculateGPT(
  scores: CategoryScoreMap,
  weights: ScoreWeight[]
): number {
  return calculateGPTWithDiagnostics(scores, weights).value
}

/** Desvio-alvo na escala 0-10. Centro 5, ~1.5 σ ocupando boa parte da escala. */
const NORMALIZE_TARGET_STD = 1.5

/**
 * GPT.N = clamp(5 + (GPT - mean) / std * NORMALIZE_TARGET_STD, 0, 10)
 *
 * Z-score calibrado da distribuição real de GPT. `mean` e `std` vêm do
 * `formula_config` (calibrados a cada `recalculateAll`). Quando omitidos,
 * usa defaults (mean=5, std=4) que aproximam o comportamento antigo
 * (`5 + (gpt - 5) * 1.25`).
 */
export function normalizeGPT(gpt: number, mean = 5, std = 4): number {
  const effectiveStd = std > 0 ? std : 4
  return Math.max(
    0,
    Math.min(10, 5 + ((gpt - mean) / effectiveStd) * NORMALIZE_TARGET_STD)
  )
}
