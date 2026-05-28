/**
 * Stacker — Ridge segundo-nível que substitui o inverse-variance.
 *
 * Combina Nota.Calc + Nota.Pr (e futuramente kNN) com pesos aprendidos
 * via Ridge α=1 (regularização leve) contra `user_score`. Lida com a
 * correlação de erros que inverse-variance assume não existir.
 *
 * IMPORTANTE: o `fitStacker` recebe predições **out-of-fold** do Ridge
 * pra evitar leakage. Quem orquestra o OOF é `recalculateAll()`.
 */

import { fitRidge } from "@/lib/ml/ridge"
import type { Matrix } from "@/lib/ml/matrix"

const MIN_TRAIN_FOR_STACKER = 30
const STACKER_ALPHA = 1.0

export interface StackerInput {
  calc: number
  ridge: number
  knn?: number | null
  manual: number
}

export interface StackerCoefficients {
  intercept: number
  calcWeight: number
  ridgeWeight: number
  /** null quando kNN ainda não está no pipeline (Passo 5 ativa). */
  knnWeight: number | null
  trainSize: number
  /** MAE leave-one-out do próprio stacker — quão bem ele combina os previsores. */
  cvMAE: number
}

function meanAbsoluteError(y: number[], yhat: number[]): number {
  let s = 0
  for (let i = 0; i < y.length; i++) s += Math.abs(y[i] - yhat[i])
  return s / y.length
}

function fitOnce(X: Matrix, y: number[]): {
  intercept: number
  coefficients: number[]
} {
  // Centraliza X em torno da média de cada coluna; o intercept fechado
  // depois absorve esse offset. Isso evita que o termo de bias entre no
  // shrinkage (mesma técnica que `fitRidge` usa pra y).
  const n = X.length
  const k = X[0].length
  const means = new Array<number>(k).fill(0)
  for (const row of X) for (let j = 0; j < k; j++) means[j] += row[j]
  for (let j = 0; j < k; j++) means[j] /= n
  const Xc = X.map((row) => row.map((v, j) => v - means[j]))

  const { coefficients, intercept: yMean } = fitRidge(Xc, y, STACKER_ALPHA)

  // y ≈ yMean + Σ βⱼ (xⱼ - meanⱼ) → recuperando intercept em espaço raw
  let interceptRaw = yMean
  for (let j = 0; j < k; j++) interceptRaw -= coefficients[j] * means[j]

  return { intercept: interceptRaw, coefficients }
}

function leaveOneOutMAE(rows: StackerInput[], hasKnn: boolean): number {
  const n = rows.length
  const predictions = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const train: StackerInput[] = []
    for (let j = 0; j < n; j++) if (j !== i) train.push(rows[j])
    const X = train.map((r) =>
      hasKnn ? [r.calc, r.ridge, r.knn as number] : [r.calc, r.ridge],
    )
    const y = train.map((r) => r.manual)
    const { intercept, coefficients } = fitOnce(X, y)
    const target = rows[i]
    let pred = intercept + coefficients[0] * target.calc + coefficients[1] * target.ridge
    if (hasKnn) pred += coefficients[2] * (target.knn as number)
    predictions[i] = pred
  }
  return meanAbsoluteError(rows.map((r) => r.manual), predictions)
}

/**
 * Treina o stacker em out-of-fold predictions.
 *
 * - Espera ≥ MIN_TRAIN_FOR_STACKER linhas; abaixo retorna `null` e o caller
 *   cai pro inverse-variance.
 * - Se `knn` estiver presente e finito em TODAS as linhas, inclui como
 *   3ª feature. Caso contrário, usa só Calc + Ridge.
 * - LOOCV pra reportar `cvMAE` honesto (custo aceitável com n=100–500).
 */
export function fitStacker(rows: StackerInput[]): StackerCoefficients | null {
  const valid = rows.filter(
    (r) =>
      Number.isFinite(r.calc) &&
      Number.isFinite(r.ridge) &&
      Number.isFinite(r.manual),
  )
  if (valid.length < MIN_TRAIN_FOR_STACKER) return null

  const hasKnn = valid.every((r) => r.knn != null && Number.isFinite(r.knn))

  const X: Matrix = valid.map((r) =>
    hasKnn ? [r.calc, r.ridge, r.knn as number] : [r.calc, r.ridge],
  )
  const y = valid.map((r) => r.manual)

  const { intercept, coefficients } = fitOnce(X, y)
  const cvMAE = leaveOneOutMAE(valid, hasKnn)

  return {
    intercept,
    calcWeight: coefficients[0],
    ridgeWeight: coefficients[1],
    knnWeight: hasKnn ? coefficients[2] : null,
    trainSize: valid.length,
    cvMAE,
  }
}

/**
 * Aplica o stacker pra produzir um único `final_score` ∈ [0, 10].
 *
 * Quando `knn` é fornecido mas o stacker foi treinado sem ele (knnWeight=null),
 * o argumento é ignorado — fail-safe pra transições entre Passo 6 e Passo 5.
 */
export function predictWithStacker(
  coefs: StackerCoefficients,
  calc: number,
  ridge: number,
  knn?: number | null,
): number {
  let pred = coefs.intercept + coefs.calcWeight * calc + coefs.ridgeWeight * ridge
  if (coefs.knnWeight != null && knn != null && Number.isFinite(knn)) {
    pred += coefs.knnWeight * knn
  }
  return Math.max(0, Math.min(10, pred))
}

export { MIN_TRAIN_FOR_STACKER, STACKER_ALPHA }
