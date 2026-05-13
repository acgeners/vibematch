/**
 * NotaFinal — média ponderada por variância inversa entre Nota.Calc e Nota.Pr.
 *
 * weight_calc = 1 / MAE_calc²
 * weight_pr   = 1 / MAE_pr²
 * NotaFinal   = (calc * w_calc + pr * w_pr) / (w_calc + w_pr)
 *
 * Com MAE_calc ≈ 1.27 e MAE_pr ≈ 0.92, Nota.Pr tem peso ~1.9× maior.
 */
export function calculateNotaFinal(
  calcScore: number,
  predictedScore: number,
  maeCalc: number,
  maePredicted: number
): number {
  const wCalc = 1 / Math.pow(Math.max(maeCalc, 0.0001), 2)
  const wPr = 1 / Math.pow(Math.max(maePredicted, 0.0001), 2)
  const result = (calcScore * wCalc + predictedScore * wPr) / (wCalc + wPr)
  return Math.max(0, Math.min(10, result))
}
