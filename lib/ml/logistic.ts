/**
 * Regressão logística L2 (gradient descent) + seleção de λ por K-fold e
 * calibração Platt. Espelha as convenções de `ridge.ts`: as features chegam
 * já padronizadas pelo caller e o intercepto NÃO entra no shrinkage.
 *
 * Usada por `lib/calculations/chance.ts` — "Chance de gostar" = P(user_score ≥ τ).
 * Puro TS, sem deps nativas nem server-only (roda no recalc e em scripts).
 */

export interface LogisticModel {
  coefficients: number[]
  intercept: number
  lambda: number
  /** AUC out-of-fold no melhor λ (0.5 = inútil). */
  cvAUC: number
  /** Log-loss out-of-fold no melhor λ (menor = melhor). */
  cvLogLoss: number
}

const DEFAULT_LAMBDAS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10]

export const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
const clampP = (p: number): number => Math.min(1 - 1e-12, Math.max(1e-12, p))

/**
 * Ajusta logística L2 por gradient descent. X já padronizado; y ∈ {0,1}.
 * Regulariza só os pesos (não o intercepto), igual ao ridge com bias separado.
 */
export function fitLogistic(
  X: number[][],
  y: number[],
  lambda: number,
  iters = 3000,
  lr = 0.5,
): { coefficients: number[]; intercept: number } {
  const n = X.length
  if (n === 0) throw new Error("fitLogistic: empty dataset")
  const d = X[0].length
  const w = new Array<number>(d).fill(0)
  let b = 0
  for (let t = 0; t < iters; t++) {
    const gw = new Array<number>(d).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < d; j++) z += w[j] * X[i][j]
      const e = sigmoid(z) - y[i]
      gb += e
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j]
    }
    b -= lr * (gb / n)
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j])
  }
  return { coefficients: w, intercept: b }
}

export function logit(x: number[], model: { coefficients: number[]; intercept: number }): number {
  let z = model.intercept
  for (let j = 0; j < x.length; j++) z += model.coefficients[j] * x[j]
  return z
}

export function predictProba(X: number[][], model: { coefficients: number[]; intercept: number }): number[] {
  return X.map((x) => sigmoid(logit(x, model)))
}

/** AUC (Mann-Whitney) — prob de rankear um positivo acima de um negativo. */
export function auc(scores: number[], labels: number[]): number {
  const pairs = scores.map((s, i) => [s, labels[i]] as [number, number]).sort((a, b) => a[0] - b[0])
  // ranks com correção de empates
  const ranks = new Array<number>(pairs.length)
  let i = 0
  while (i < pairs.length) {
    let j = i
    while (j + 1 < pairs.length && pairs[j + 1][0] === pairs[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[k] = avg
    i = j + 1
  }
  let nPos = 0, sumPosRank = 0
  for (let k = 0; k < pairs.length; k++) {
    if (pairs[k][1] === 1) { nPos++; sumPosRank += ranks[k] }
  }
  const nNeg = pairs.length - nPos
  if (nPos === 0 || nNeg === 0) return NaN
  return (sumPosRank - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)
}

export function logLoss(probs: number[], labels: number[]): number {
  let s = 0
  for (let i = 0; i < probs.length; i++) {
    const p = clampP(probs[i])
    s += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p))
  }
  return s / probs.length
}

/** Índices K-fold embaralhados com LCG determinístico (seed 42). */
export function kFoldIndices(n: number, k: number, seed = 42): number[][] {
  const order = Array.from({ length: n }, (_, i) => i)
  let state = seed >>> 0
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const folds: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) folds[i % k].push(order[i])
  return folds
}

/** Predições out-of-fold (probabilidades) para um λ fixo. */
function oofProba(X: number[][], y: number[], lambda: number, k: number): number[] {
  const n = X.length
  const preds = new Array<number>(n).fill(0.5)
  for (const fold of kFoldIndices(n, k)) {
    const test = new Set(fold)
    const Xtr: number[][] = [], ytr: number[] = []
    for (let i = 0; i < n; i++) if (!test.has(i)) { Xtr.push(X[i]); ytr.push(y[i]) }
    if (Xtr.length === 0) continue
    const m = fitLogistic(Xtr, ytr, lambda)
    for (const i of fold) preds[i] = sigmoid(logit(X[i], m))
  }
  return preds
}

/** Logits out-of-fold (para calibração Platt sem leakage). */
export function oofLogits(X: number[][], y: number[], lambda: number, k = 5): number[] {
  const n = X.length
  const out = new Array<number>(n).fill(0)
  for (const fold of kFoldIndices(n, k)) {
    const test = new Set(fold)
    const Xtr: number[][] = [], ytr: number[] = []
    for (let i = 0; i < n; i++) if (!test.has(i)) { Xtr.push(X[i]); ytr.push(y[i]) }
    if (Xtr.length === 0) continue
    const m = fitLogistic(Xtr, ytr, lambda)
    for (const i of fold) out[i] = logit(X[i], m)
  }
  return out
}

/** LogisticCV: escolhe λ minimizando log-loss OOF; reporta AUC + log-loss. */
export function fitLogisticCV(X: number[][], y: number[], lambdas: number[] = DEFAULT_LAMBDAS, k = 5): LogisticModel {
  const n = X.length
  if (n === 0) throw new Error("fitLogisticCV: empty dataset")
  const effK = Math.max(2, Math.min(k, n))
  let best = lambdas[0], bestLoss = Infinity, bestAUC = 0.5
  for (const lam of lambdas) {
    const oof = oofProba(X, y, lam, effK)
    const loss = logLoss(oof, y)
    if (loss < bestLoss) { bestLoss = loss; best = lam; bestAUC = auc(oof, y) }
  }
  const final = fitLogistic(X, y, best)
  return { coefficients: final.coefficients, intercept: final.intercept, lambda: best, cvAUC: bestAUC, cvLogLoss: bestLoss }
}

/**
 * Platt scaling: ajusta P = sigmoid(A·s + B) sobre scores `s` (logits) e
 * rótulos, para transformar scores brutos em probabilidades calibradas.
 * Reusa a própria logística 1-D (sem regularização).
 */
export function fitPlatt(scores: number[], labels: number[]): { A: number; B: number } {
  const m = fitLogistic(scores.map((s) => [s]), labels, 0, 2500, 0.1)
  return { A: m.coefficients[0], B: m.intercept }
}

export { DEFAULT_LAMBDAS }
