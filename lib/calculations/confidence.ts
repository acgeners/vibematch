/**
 * Confiança individual (0–1) na Nota.Final de uma obra.
 *
 * Combina 3 sinais:
 *   - base: derivado do RMSE global do ensemble (quanto menor o erro
 *           médio, mais confiável qualquer previsão individual)
 *   - outlier_factor: decai exponencialmente quando a obra está fora
 *                     da densidade do treino (distance > P95)
 *   - stub_penalty: piso baixo quando o Ridge está em modo stub
 *                   (poucos dados → previsão é só a média)
 *
 * Retorna `null` quando rmseFinal é null (calibração insuficiente):
 * sem ground truth o suficiente, não dá pra estimar confiança honesta.
 */

const STUB_CONFIDENCE = 0.3
const BASE_MIN = 0.2
const BASE_MAX = 1.0
const RMSE_TO_BASE_DIVISOR = 5

export function calculateFinalScoreConfidence(args: {
  rmseFinal: number | null
  predictedIsStub: boolean
  predictionDistance: number | null
  distanceP95: number | null
}): number | null {
  const { rmseFinal, predictedIsStub, predictionDistance, distanceP95 } = args

  if (rmseFinal == null) return null

  const base = Math.max(BASE_MIN, Math.min(BASE_MAX, 1 - rmseFinal / RMSE_TO_BASE_DIVISOR))

  if (predictedIsStub) {
    return Math.min(base, STUB_CONFIDENCE)
  }

  let outlierFactor = 1
  if (predictionDistance != null && distanceP95 != null && distanceP95 > 0) {
    if (predictionDistance > distanceP95) {
      outlierFactor = Math.exp(-(predictionDistance - distanceP95) / distanceP95)
    }
  }

  return Math.max(0, Math.min(1, base * outlierFactor))
}
