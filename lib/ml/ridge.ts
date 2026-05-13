/**
 * Ridge Regression com bias separado e seleção de alpha por K-fold CV.
 *
 * Replica o comportamento de:
 *   sklearn.linear_model.RidgeCV(alphas=[0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000])
 *   dentro de um Pipeline(StandardScaler -> RidgeCV)
 *
 * Com features padronizadas (StandardScaler), o termo de bias não entra no
 * shrinkage — implementamos isso centralizando y e ajustando β = (XᵀX + αI)⁻¹ Xᵀy
 * usando Cholesky (XᵀX + αI é simétrica positivo-definida para α > 0).
 */

import { multiply, multiplyVec, solveSPD, transpose, type Matrix } from "./matrix"

const DEFAULT_ALPHAS = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]

export interface RidgeModel {
  coefficients: number[]
  intercept: number
  alpha: number
  cvMAE: number
  cvRMSE: number
}

/**
 * Ajusta Ridge Regression com α fixo e features já padronizadas/centralizadas.
 * Retorna apenas os coeficientes e intercepto (não fecha sobre dados de treino).
 */
export function fitRidge(
  X: Matrix,
  y: number[],
  alpha: number
): { coefficients: number[]; intercept: number } {
  const n = X.length
  if (n === 0) throw new Error("fitRidge: empty dataset")

  // Centraliza y para tirar o intercepto da regularização
  const yMean = y.reduce((a, b) => a + b, 0) / n
  const yc = y.map((v) => v - yMean)

  const Xt = transpose(X)
  const XtX = multiply(Xt, X)

  // Soma α na diagonal (Tikhonov)
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += alpha

  const Xty = multiplyVec(Xt, yc)
  const coefficients = solveSPD(XtX, Xty)

  return { coefficients, intercept: yMean }
}

export function predictRidge(
  X: Matrix,
  model: { coefficients: number[]; intercept: number }
): number[] {
  return multiplyVec(X, model.coefficients).map((v) => v + model.intercept)
}

function meanAbsoluteError(y: number[], yhat: number[]): number {
  let sum = 0
  for (let i = 0; i < y.length; i++) sum += Math.abs(y[i] - yhat[i])
  return sum / y.length
}

function rootMeanSquaredError(y: number[], yhat: number[]): number {
  let sum = 0
  for (let i = 0; i < y.length; i++) {
    const d = y[i] - yhat[i]
    sum += d * d
  }
  return Math.sqrt(sum / y.length)
}

/**
 * Gera índices para K-fold CV (shuffled, seed determinística).
 */
function kFoldIndices(n: number, k: number, seed = 42): number[][] {
  const order: number[] = Array.from({ length: n }, (_, i) => i)
  // Fisher-Yates com seeded LCG
  let state = seed
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  const folds: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) folds[i % k].push(order[i])
  return folds
}

/**
 * Cross-validated MAE para um α específico.
 */
function crossValMAE(X: Matrix, y: number[], alpha: number, k: number): number {
  const n = X.length
  const folds = kFoldIndices(n, k)
  const predicted = new Array<number>(n).fill(0)

  for (let f = 0; f < folds.length; f++) {
    const testIdx = new Set(folds[f])
    const Xtrain: Matrix = []
    const ytrain: number[] = []
    const Xtest: Matrix = []
    const testOrder: number[] = []
    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        Xtest.push(X[i])
        testOrder.push(i)
      } else {
        Xtrain.push(X[i])
        ytrain.push(y[i])
      }
    }
    if (Xtrain.length === 0 || Xtest.length === 0) continue
    const model = fitRidge(Xtrain, ytrain, alpha)
    const preds = predictRidge(Xtest, model)
    for (let i = 0; i < testOrder.length; i++) predicted[testOrder[i]] = preds[i]
  }

  return meanAbsoluteError(y, predicted)
}

/**
 * RidgeCV: escolhe o melhor α por K-fold (default 5) e ajusta o modelo final.
 */
export function fitRidgeCV(
  X: Matrix,
  y: number[],
  alphas: number[] = DEFAULT_ALPHAS,
  k = 5
): RidgeModel {
  const n = X.length
  if (n === 0) throw new Error("fitRidgeCV: empty dataset")

  const effectiveK = Math.max(2, Math.min(k, n))

  let bestAlpha = alphas[0]
  let bestMAE = Infinity
  for (const a of alphas) {
    const mae = crossValMAE(X, y, a, effectiveK)
    if (mae < bestMAE) {
      bestMAE = mae
      bestAlpha = a
    }
  }

  // Ajusta modelo final com todos os dados
  const final = fitRidge(X, y, bestAlpha)

  // Re-roda CV pra reportar RMSE no melhor alpha
  const folds = kFoldIndices(n, effectiveK)
  const predicted = new Array<number>(n).fill(0)
  for (let f = 0; f < folds.length; f++) {
    const testIdx = new Set(folds[f])
    const Xtrain: Matrix = []
    const ytrain: number[] = []
    const Xtest: Matrix = []
    const testOrder: number[] = []
    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        Xtest.push(X[i])
        testOrder.push(i)
      } else {
        Xtrain.push(X[i])
        ytrain.push(y[i])
      }
    }
    if (Xtrain.length === 0 || Xtest.length === 0) continue
    const m = fitRidge(Xtrain, ytrain, bestAlpha)
    const preds = predictRidge(Xtest, m)
    for (let i = 0; i < testOrder.length; i++) predicted[testOrder[i]] = preds[i]
  }

  return {
    coefficients: final.coefficients,
    intercept: final.intercept,
    alpha: bestAlpha,
    cvMAE: bestMAE,
    cvRMSE: rootMeanSquaredError(y, predicted),
  }
}

export { DEFAULT_ALPHAS, meanAbsoluteError, rootMeanSquaredError }
