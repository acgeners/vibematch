/**
 * Inferência dos pesos pós-leitura a partir do histórico.
 *
 * Treina uma Ridge restrita aos 8 critérios pós-leitura (`post_*_score`) contra
 * `calculated_scores.expected_score` (Nota Prevista). Os coeficientes traduzem
 * "quanto cada eixo pós-leitura prediz a nota prevista do sistema". Normalizamos
 * pra escala dos pesos atuais (preservando intensidade total) e estimamos
 * confiança via bootstrap.
 *
 * IMPORTANTE — escolha de target:
 * `user_score` é função direta dos próprios `post_*_score` ponderados pelos
 * pesos atuais (calculado client-side). Usá-lo como target seria circular —
 * Ridge apenas recuperaria os pesos atuais. Usamos `expected_score`, que mistura
 * GPT + plataformas externas + penalidades + Ridge preditor; só uma fração dele
 * depende indiretamente dos `post_*_score`. (Antes usava `final_score`, aposentado
 * na faxina do pipeline legado — a feature ficava muda enquanto a coluna era null.)
 *
 * Mesma estrutura de `weight-inference.ts` (IA), só trocando features/target.
 */

import {
  DEFAULT_POST_READING_WEIGHTS,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { MedianImputer, StandardScaler } from "@/lib/ml/preprocessing"
import { fitRidgeCV } from "@/lib/ml/ridge"

const MIN_TRAIN_FOR_INFERENCE = 20
const BOOTSTRAP_ITERATIONS = 50
const CONFIDENCE_HIGH = 3.0
const CONFIDENCE_MEDIUM = 1.5

export type WeightConfidence = "high" | "medium" | "low"

export const POST_READING_FIELDS = Object.keys(
  DEFAULT_POST_READING_WEIGHTS,
) as PostReadingScoreField[]

export type PostReadingScoreMap = Partial<Record<PostReadingScoreField, number | null>>

export interface PostReadingWeightInferenceInput {
  workId: string
  postScores: PostReadingScoreMap
  target: number
}

export interface PostReadingWeightSuggestion {
  field: PostReadingScoreField
  currentWeight: number
  suggestedWeight: number
  delta: number
  confidence: WeightConfidence
  coefficient: number
  stderr: number
}

export interface PostReadingWeightInferenceResult {
  trainSize: number
  isStub: boolean
  suggestions: PostReadingWeightSuggestion[]
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
  inputs: PostReadingWeightInferenceInput[],
): { X: (number | null)[][]; y: number[] } {
  const X: (number | null)[][] = []
  const y: number[] = []
  for (const inp of inputs) {
    const row: (number | null)[] = []
    for (const field of POST_READING_FIELDS) {
      const v = inp.postScores[field]
      row.push(v == null || !Number.isFinite(v) ? null : v)
    }
    X.push(row)
    y.push(inp.target)
  }
  return { X, y }
}

function fitWeightModel(
  inputs: PostReadingWeightInferenceInput[],
): { coefficients: number[]; alpha: number; cvMAE: number } | null {
  if (inputs.length < 2) return null

  const { X: Xraw, y } = buildMatrices(inputs)
  const imputer = new MedianImputer().fit(Xraw)
  const Ximputed = imputer.transform(Xraw)
  const scaler = new StandardScaler().fit(Ximputed)
  const Xscaled = scaler.transform(Ximputed)

  const cvFolds = Math.max(2, Math.min(inputs.length, inputs.length < 50 ? inputs.length : 5))
  const model = fitRidgeCV(Xscaled, y, undefined, cvFolds)

  const coefficients = model.coefficients.map((c, i) => {
    const std = scaler.stds[i]
    return std > 0 ? c / std : 0
  })

  return { coefficients, alpha: model.alpha, cvMAE: model.cvMAE }
}

function bootstrapCoefficients(
  inputs: PostReadingWeightInferenceInput[],
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
 * Coeficientes negativos não fazem sentido aqui — uma nota mais alta num eixo
 * pós-leitura nunca deveria DIMINUIR a Nota.Final esperada. Quando aparecem,
 * tratamos como "esse eixo não tem sinal útil" e zeramos antes de redimensionar.
 */
function rescaleSuggestions(
  coefficients: number[],
  currentWeights: number[],
): number[] {
  const clipped = coefficients.map((c) => (c > 0 ? c : 0))
  const sumCoef = clipped.reduce((s, c) => s + c, 0)
  if (sumCoef === 0) return clipped.map(() => 0)
  const sumCurrent = currentWeights.reduce((s, w) => s + Math.max(w, 0), 0)
  const targetSum = sumCurrent > 0 ? sumCurrent : currentWeights.length
  const factor = targetSum / sumCoef
  return clipped.map((c) => Math.round(c * factor * 2) / 2)
}

export function inferPostReadingWeights(
  inputs: PostReadingWeightInferenceInput[],
  currentWeights: Record<PostReadingScoreField, number>,
): PostReadingWeightInferenceResult {
  const valid = inputs.filter((inp) => {
    if (!Number.isFinite(inp.target)) return false
    for (const field of POST_READING_FIELDS) {
      const v = inp.postScores[field]
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
  const meanCoef = boot?.mean ?? finalFit.coefficients
  const stdCoef = boot?.std ?? finalFit.coefficients.map(() => 0)

  const currentVec = POST_READING_FIELDS.map((f) => currentWeights[f] ?? 0)
  const rescaled = rescaleSuggestions(meanCoef, currentVec)

  const suggestions: PostReadingWeightSuggestion[] = POST_READING_FIELDS.map((field, i) => {
    const current = currentVec[i]
    const suggested = rescaled[i]
    return {
      field,
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
