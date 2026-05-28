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

/**
 * GPT.N = clamp(5 + (gpt - 5) * 1.25, 0, 10)
 *
 * Amplificação simples em torno do ponto neutro 5. O slope 1.25 foi calibrado
 * empiricamente. Tentamos z-score adaptativo (mean/std da distribuição real)
 * mas afundava IA(n) porque recentrava o output em 5 — a média dos user_score
 * fica em ~7–8, então recentrar GPT em 5 quebra a calibração contra o target.
 * As colunas formula_config.gpt_mean/gpt_std permanecem no DB como legacy.
 */
export function normalizeGPT(gpt: number): number {
  return Math.max(0, Math.min(10, 5 + (gpt - 5) * 1.25))
}
