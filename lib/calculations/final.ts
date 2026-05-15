/**
 * NotaFinal — média ponderada por variância inversa entre Nota.Calc e Nota.Pr.
 *
 * weight_calc = 1 / RMSE_calc²
 * weight_pr   = 1 / RMSE_pr²
 * NotaFinal   = (calc * w_calc + pr * w_pr) / (w_calc + w_pr)
 *
 * RMSE² é a variância dos resíduos de média ~zero — por isso o peso é
 * matematicamente "variância inversa". O código antigo usava MAE², que é
 * apenas heurístico (MAE ≠ variância).
 *
 * Quando `rmsePredicted` é null (calibração insuficiente), a função retorna
 * `calcScore` puro: blend com peso "chutado" arrastaria o score pra média.
 */
export function calculateNotaFinal(
  calcScore: number,
  predictedScore: number,
  rmseCalc: number | null,
  rmsePredicted: number | null
): number {
  if (rmseCalc == null || rmsePredicted == null) {
    return Math.max(0, Math.min(10, calcScore))
  }
  const wCalc = 1 / Math.pow(Math.max(rmseCalc, 0.0001), 2)
  const wPr = 1 / Math.pow(Math.max(rmsePredicted, 0.0001), 2)
  const result = (calcScore * wCalc + predictedScore * wPr) / (wCalc + wPr)
  return Math.max(0, Math.min(10, result))
}
