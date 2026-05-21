import { predictWithStacker, type StackerCoefficients } from "./stacker"

/**
 * NotaFinal — fachada que escolhe entre stacker (Passo 6+) e inverse-variance
 * (legado). Quando `stackerCoefs` está disponível e `useStacker` é true, usa
 * o stacker; caso contrário cai pro inverse-variance histórico.
 */
export function calculateNotaFinalChoosing(
  calc: number,
  ridge: number,
  rmseCalc: number | null,
  rmseRidge: number | null,
  distanceFactor: number,
  useStacker: boolean,
  stackerCoefs: StackerCoefficients | null,
  knn?: number | null,
): number {
  if (useStacker && stackerCoefs) {
    return predictWithStacker(stackerCoefs, calc, ridge, knn)
  }
  return calculateNotaFinal(calc, ridge, rmseCalc, rmseRidge, distanceFactor)
}

/**
 * NotaFinal (legado) — média ponderada por variância inversa entre Nota.Calc e Nota.Pr.
 *
 * weight_calc = 1 / RMSE_calc²
 * weight_pr   = 1 / RMSE_pr²  ×  distanceFactor
 * NotaFinal   = (calc * w_calc + pr * w_pr) / (w_calc + w_pr)
 *
 * RMSE² é a variância dos resíduos de média ~zero — por isso o peso é
 * matematicamente "variância inversa".
 *
 * `distanceFactor` (default 1) é um multiplicador entre 0 e 1 que reduz o
 * peso de Nota.Pr pra títulos fora-da-distribuição (distância alta ao
 * centróide do treino). Quando 0, o ensemble vira Nota.Calc puro.
 *
 * Quando `rmsePredicted` é null (calibração insuficiente), retorna calcScore.
 *
 * @deprecated Mantido como fallback quando o stacker não está disponível.
 */
export function calculateNotaFinal(
  calcScore: number,
  predictedScore: number,
  rmseCalc: number | null,
  rmsePredicted: number | null,
  distanceFactor = 1
): number {
  if (rmseCalc == null || rmsePredicted == null) {
    return Math.max(0, Math.min(10, calcScore))
  }
  const wCalc = 1 / Math.pow(Math.max(rmseCalc, 0.0001), 2)
  const wPr = (1 / Math.pow(Math.max(rmsePredicted, 0.0001), 2)) * Math.max(0, Math.min(1, distanceFactor))
  if (wPr <= 0) return Math.max(0, Math.min(10, calcScore))
  const result = (calcScore * wCalc + predictedScore * wPr) / (wCalc + wPr)
  return Math.max(0, Math.min(10, result))
}
