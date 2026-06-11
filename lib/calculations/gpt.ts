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
 * GPT.N = clamp(center + (gpt - center) * 1.25, 0, 10)
 *
 * Amplificação em torno de `center`. `recalculateAll` passa a média do GPT cru
 * do catálogo (persistida em formula_config.gpt_mean) como centro; o default 5
 * é só fallback retrocompatível pra caminhos single-work sem o contexto do
 * catálogo. Centrar em 5 quando a distribuição real centra em ~7 empurrava tudo
 * acima de 5 pra cima — viés sistemático de +0.20 no calc_score. Centrar na
 * média mata esse viés. (O z-score adaptativo que tentamos antes afundava IA(n)
 * porque dividia pelo std E recentrava em 5/0; centrar na média SEM dividir pelo
 * std evita esse modo de falha.) Slope 1.25 fixo — super-amplificar piora a MAE.
 *
 * Só afeta calc_score: a feature IA(n) do Ridge passa por StandardScaler, que é
 * invariante a qualquer centro/escala constante.
 */
export function normalizeGPT(gpt: number, center = 5): number {
  return Math.max(0, Math.min(10, center + (gpt - center) * 1.25))
}
