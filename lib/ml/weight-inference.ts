/**
 * Inferência de `score_weights` a partir do histórico de `manual_score`.
 *
 * Treina uma Ridge restrita aos 9 critérios IA (sem outras features) contra
 * `manual_score`. Os coeficientes resultantes traduzem "quanto cada critério
 * importa pra prever a nota real do usuário". Normalizamos esses coeficientes
 * pra escala dos `score_weights` atuais (preservando intensidade total) e
 * estimamos confiança via bootstrap.
 *
 * Diferente do Ridge "principal" (em `prediction.ts`):
 *   - Aqui usamos APENAS os 9 critérios + intercepto. Sem features auxiliares
 *     (LogVotos, IA(n), tags, etc.). Resultado limpo, interpretável.
 *   - Aqui só treinamos pra extrair coeficientes — não pra prever.
 *   - Confiança via bootstrap (resample com reposição, ver std dos coefs).
 */

import { CRITERION_SLUGS, type CategoryScoreMap, type CriterionSlug } from "@/types/domain"
import { MedianImputer, StandardScaler } from "@/lib/ml/preprocessing"
import { fitRidgeCV } from "@/lib/ml/ridge"

const MIN_TRAIN_FOR_INFERENCE = 20
const BOOTSTRAP_ITERATIONS = 50
/** Razão sinal/ruído pra classificar confiança. */
const CONFIDENCE_HIGH = 3.0
const CONFIDENCE_MEDIUM = 1.5

export type WeightConfidence = "high" | "medium" | "low"

export interface WeightSuggestion {
  slug: CriterionSlug
  currentWeight: number
  suggestedWeight: number
  delta: number
  confidence: WeightConfidence
  /** Coeficiente médio do bootstrap em unidades de manual_score por 1 ponto no critério. */
  coefficient: number
  /** Desvio-padrão do coeficiente entre bootstraps — base do nível de confiança. */
  stderr: number
}

export interface WeightInferenceInput {
  workId: string
  categoryScores: CategoryScoreMap
  manualScore: number
}

export interface CurrentWeight {
  slug: CriterionSlug
  weight: number
}

export interface WeightInferenceResult {
  trainSize: number
  /** `true` quando treino < MIN_TRAIN_FOR_INFERENCE; sugestões viram array vazio. */
  isStub: boolean
  suggestions: WeightSuggestion[]
  alpha: number
  cvMAE: number
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function bootstrapSample<T>(items: T[], random: () => number): T[] {
  const n = items.length
  const out: T[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = items[Math.floor(random() * n)]
  return out
}

function buildMatrices(
  inputs: WeightInferenceInput[],
): { X: (number | null)[][]; y: number[] } {
  const X: (number | null)[][] = []
  const y: number[] = []
  for (const inp of inputs) {
    const row: (number | null)[] = []
    for (const slug of CRITERION_SLUGS) {
      const v = inp.categoryScores[slug as CriterionSlug]
      row.push(v == null || !Number.isFinite(v) ? null : v)
    }
    X.push(row)
    y.push(inp.manualScore)
  }
  return { X, y }
}

/**
 * Treina Ridge nos 9 critérios e devolve coeficientes em escala ORIGINAL
 * (não padronizada). Retorna `null` quando não há dados suficientes.
 */
function fitWeightModel(
  inputs: WeightInferenceInput[],
): { coefficients: number[]; alpha: number; cvMAE: number } | null {
  if (inputs.length < 2) return null

  const { X: Xraw, y } = buildMatrices(inputs)
  const imputer = new MedianImputer().fit(Xraw)
  const Ximputed = imputer.transform(Xraw)
  const scaler = new StandardScaler().fit(Ximputed)
  const Xscaled = scaler.transform(Ximputed)

  // CV-folds: LOOCV abaixo de 50, 5-fold acima — mesmo critério do Ridge principal.
  const cvFolds = Math.max(2, Math.min(inputs.length, inputs.length < 50 ? inputs.length : 5))
  const model = fitRidgeCV(Xscaled, y, undefined, cvFolds)

  // Reverter padronização: coef_original = coef_scaled / std_feature
  // (intercepto é absorvido pelo ridge — não precisamos dele aqui)
  const coefficients = model.coefficients.map((c, i) => {
    const std = scaler.stds[i]
    return std > 0 ? c / std : 0
  })

  return { coefficients, alpha: model.alpha, cvMAE: model.cvMAE }
}

/**
 * Calcula coeficientes médios e desvio padrão via bootstrap. Permite estimar
 * confiança em cada slug — coeficientes que oscilam entre amostras têm menos
 * sinal preditivo independente do seu valor médio.
 */
function bootstrapCoefficients(
  inputs: WeightInferenceInput[],
  iterations: number,
  seed = 42,
): { mean: number[]; std: number[] } | null {
  const random = rng(seed)
  const samples: number[][] = []
  for (let i = 0; i < iterations; i++) {
    const sample = bootstrapSample(inputs, random)
    const fit = fitWeightModel(sample)
    if (fit) samples.push(fit.coefficients)
  }
  if (samples.length === 0) return null

  const k = samples[0].length
  const mean = new Array<number>(k).fill(0)
  for (const row of samples) for (let j = 0; j < k; j++) mean[j] += row[j]
  for (let j = 0; j < k; j++) mean[j] /= samples.length

  const std = new Array<number>(k).fill(0)
  for (const row of samples) {
    for (let j = 0; j < k; j++) {
      const d = row[j] - mean[j]
      std[j] += d * d
    }
  }
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j] / samples.length)

  return { mean, std }
}

function classifyConfidence(coef: number, stderr: number): WeightConfidence {
  if (stderr <= 0 || !Number.isFinite(stderr)) return "low"
  const ratio = Math.abs(coef) / stderr
  if (ratio >= CONFIDENCE_HIGH) return "high"
  if (ratio >= CONFIDENCE_MEDIUM) return "medium"
  return "low"
}

/**
 * Mapeia coeficientes (em escala "ponto-de-manual_score por ponto-de-critério")
 * pra escala dos `score_weights` (faixa típica ±10), preservando a magnitude
 * total dos pesos atuais. Isso evita que sugestões fiquem em escalas
 * incomparáveis com a edição manual.
 */
function rescaleSuggestions(
  coefficients: number[],
  currentWeights: CurrentWeight[],
): number[] {
  const sumAbsCoef = coefficients.reduce((s, c) => s + Math.abs(c), 0)
  if (sumAbsCoef === 0) return coefficients.map(() => 0)
  const sumAbsCurrent = currentWeights.reduce((s, w) => s + Math.abs(w.weight), 0)
  // Fallback: se todos os pesos atuais são zero, escala pra ±10 pelo maior abs
  const targetSum = sumAbsCurrent > 0 ? sumAbsCurrent : 10 * coefficients.length
  const factor = targetSum / sumAbsCoef
  return coefficients.map((c) => Math.round(c * factor * 10) / 10)
}

export function inferScoreWeights(
  inputs: WeightInferenceInput[],
  currentWeights: CurrentWeight[],
): WeightInferenceResult {
  // Filtra obras com todos os 9 critérios presentes E manual_score válido
  const valid = inputs.filter((inp) => {
    if (!Number.isFinite(inp.manualScore)) return false
    for (const slug of CRITERION_SLUGS) {
      const v = inp.categoryScores[slug as CriterionSlug]
      if (v == null || !Number.isFinite(v)) return false
    }
    return true
  })

  if (valid.length < MIN_TRAIN_FOR_INFERENCE) {
    return {
      trainSize: valid.length,
      isStub: true,
      suggestions: [],
      alpha: 0,
      cvMAE: 0,
    }
  }

  const finalFit = fitWeightModel(valid)
  if (!finalFit) {
    return {
      trainSize: valid.length,
      isStub: true,
      suggestions: [],
      alpha: 0,
      cvMAE: 0,
    }
  }

  const boot = bootstrapCoefficients(valid, BOOTSTRAP_ITERATIONS)
  // Se bootstrap falhou (raro), usa fit final como mean e std=0 (vira "low" sempre)
  const meanCoef = boot?.mean ?? finalFit.coefficients
  const stdCoef = boot?.std ?? finalFit.coefficients.map(() => 0)

  const currentBySlug = new Map(currentWeights.map((w) => [w.slug, w.weight]))
  const rescaled = rescaleSuggestions(meanCoef, currentWeights)

  const suggestions: WeightSuggestion[] = CRITERION_SLUGS.map((slug, i) => {
    const current = currentBySlug.get(slug) ?? 0
    const suggested = rescaled[i]
    return {
      slug,
      currentWeight: current,
      suggestedWeight: suggested,
      delta: Math.round((suggested - current) * 10) / 10,
      confidence: classifyConfidence(meanCoef[i], stdCoef[i]),
      coefficient: Math.round(meanCoef[i] * 1000) / 1000,
      stderr: Math.round(stdCoef[i] * 1000) / 1000,
    }
  })

  return {
    trainSize: valid.length,
    isStub: false,
    suggestions,
    alpha: finalFit.alpha,
    cvMAE: Math.round(finalFit.cvMAE * 1000) / 1000,
  }
}

export { MIN_TRAIN_FOR_INFERENCE }
