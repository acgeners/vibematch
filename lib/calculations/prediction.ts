/**
 * Nota.Pr — Ridge Regression replicando o script Python (_manhwas_predict.py).
 *
 * Pipeline equivalente a:
 *   ColumnTransformer(
 *     numeric:     SimpleImputer(median) -> StandardScaler
 *     categorical: SimpleImputer(most_frequent) -> OneHotEncoder
 *   ) -> RidgeCV(alphas=[0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000], cv=5)
 *
 * Treina nos títulos com manual_score preenchido e prediz para todos.
 */

import { CRITERION_SLUGS, type CategoryScoreMap, type CriterionSlug } from "@/types/domain"
import {
  CategoricalImputer,
  MedianImputer,
  OneHotEncoder,
  StandardScaler,
  hstack,
  type NumericRow,
} from "@/lib/ml/preprocessing"
import { fitRidgeCV, predictRidge, type RidgeModel } from "@/lib/ml/ridge"
import { normalizeChapters } from "./chapters"

const SINOPSE_MAP: Record<string, number> = {
  "♥": 2,
  "♥♥": 5,
  "♥♥♥": 8,
  "♥♥♥♥": 13,
}

const NUMERIC_FEATURE_NAMES = [
  ...CRITERION_SLUGS,
  "IA(n)",
  "Nota.M",
  "LogVotos",
  "Cps.N",
  "SinopseScore",
  "ObsAdjustment",
  "MeanPostScore",
  "LovedTagOverlap",
  "AvoidedTagOverlap",
  "CriterionFitScore",
] as const

const CATEGORICAL_FEATURE_NAMES = ["Status"] as const

/** Dados de entrada para o pipeline de predição (1 título). */
export interface PredictionInput {
  categoryScores: CategoryScoreMap
  iaEvalNormalized: number | null
  platformAvg: number | null
  totalVotes: number
  totalChapters: number | null
  synopsisQuality: string | null
  observationAdjustment: number
  publicationStatus: string
  /**
   * Sinais pré-computados a partir do TasteProfile + post-reading-scores.
   * Todos podem ser `null` quando não há perfil ou dado correspondente —
   * o MedianImputer lida no pipeline.
   */
  meanPostScore: number | null
  lovedTagOverlap: number | null
  avoidedTagOverlap: number | null
  criterionFitScore: number | null
}

export interface PredictionWithDistance {
  predictions: number[]
  /**
   * Distância Euclidiana entre cada input e o centróide do conjunto de treino
   * no espaço de features padronizadas (numéricas + one-hot). Pode ser usada
   * pra ponderar a confiança da predição: distância alta → input fora-da-
   * distribuição → menor peso pra Nota.Pr em Nota.Final.
   *
   * No fallback (stub), todas as distâncias são 0 (sem informação).
   */
  distances: number[]
}

export interface TrainedPredictor {
  predict(inputs: PredictionInput[]): number[]
  predictWithDistance(inputs: PredictionInput[]): PredictionWithDistance
  model: RidgeModel
  trainSize: number
  featureNames: string[]
  /** Se false, treinou Ridge real. Se true, usou fallback (poucos dados). */
  isStub: boolean
}

function buildNumericRow(input: PredictionInput): NumericRow {
  const row: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) {
    const v = input.categoryScores[slug as CriterionSlug]
    row.push(v == null || !Number.isFinite(v) ? null : v)
  }
  row.push(input.iaEvalNormalized ?? null)
  row.push(input.platformAvg ?? null)
  row.push(Math.log1p(Math.max(input.totalVotes, 0)))
  row.push(normalizeChapters(input.totalChapters))
  row.push(input.synopsisQuality ? SINOPSE_MAP[input.synopsisQuality] ?? null : null)
  row.push(Math.min(Math.max(input.observationAdjustment, -0.30), 0.30))
  row.push(input.meanPostScore ?? null)
  row.push(input.lovedTagOverlap ?? null)
  row.push(input.avoidedTagOverlap ?? null)
  row.push(input.criterionFitScore ?? null)
  return row
}

function buildCategoricalRow(input: PredictionInput): string[] {
  return [input.publicationStatus || "Unknown"]
}

/**
 * Treina o modelo de Nota.Pr.
 *
 * @param trainInputs títulos com manual_score preenchido
 * @param trainTargets vetor M.Nota correspondente
 *
 * Se trainInputs.length < 20, retorna um stub que devolve um valor neutro
 * (replicando o comportamento de "poucos dados" sem quebrar a aplicação).
 */
export function trainPredictor(
  trainInputs: PredictionInput[],
  trainTargets: number[]
): TrainedPredictor {
  if (trainInputs.length !== trainTargets.length) {
    throw new Error("trainPredictor: inputs and targets length mismatch")
  }

  const MIN_TRAIN = 20

  // Imputers e encoders treinados em todo o conjunto disponível
  const numericRows = trainInputs.map(buildNumericRow)
  const categoricalRows = trainInputs.map(buildCategoricalRow)

  if (trainInputs.length < MIN_TRAIN) {
    // Fallback: usa a média de M.Nota como predição constante
    const fallbackMean =
      trainTargets.length > 0
        ? trainTargets.reduce((a, b) => a + b, 0) / trainTargets.length
        : 7.0
    return {
      predict: (rows: PredictionInput[]) => rows.map(() => fallbackMean),
      predictWithDistance: (rows: PredictionInput[]) => ({
        predictions: rows.map(() => fallbackMean),
        distances: rows.map(() => 0),
      }),
      model: {
        coefficients: [],
        intercept: fallbackMean,
        alpha: 0,
        cvMAE: 0,
        cvRMSE: 0,
      },
      trainSize: trainInputs.length,
      featureNames: [],
      isStub: true,
    }
  }

  const numImputer = new MedianImputer().fit(numericRows)
  const numImputed = numImputer.transform(numericRows)
  const numScaler = new StandardScaler().fit(numImputed)
  const numScaled = numScaler.transform(numImputed)

  const catImputer = new CategoricalImputer().fit(categoricalRows)
  const catImputed = catImputer.transform(categoricalRows)
  const catEncoder = new OneHotEncoder().fit(catImputed)
  const catEncoded = catEncoder.transform(catImputed)

  const Xtrain = hstack(numScaled, catEncoded)
  // CV híbrido: LOOCV (k=n) entre 20-49 samples por baixa razão amostras/features;
  // 5-fold a partir de 50, balanceando custo (LOOCV é O(n) ajustes) e estabilidade do MAE.
  const cvFolds = trainInputs.length < 50 ? trainInputs.length : 5
  const model = fitRidgeCV(Xtrain, trainTargets, undefined, cvFolds)

  // Centróide do treino (features padronizadas têm média 0 nas numéricas).
  // Pro one-hot a média é a frequência relativa de cada categoria.
  const featureDim = Xtrain[0]?.length ?? 0
  const centroid = new Array<number>(featureDim).fill(0)
  for (const row of Xtrain) {
    for (let j = 0; j < featureDim; j++) centroid[j] += row[j]
  }
  for (let j = 0; j < featureDim; j++) centroid[j] /= Xtrain.length

  const featureNames = [
    ...NUMERIC_FEATURE_NAMES,
    ...catEncoder.featureNames(CATEGORICAL_FEATURE_NAMES as unknown as string[]),
  ]

  function transform(inputs: PredictionInput[]): number[][] {
    const numRows = inputs.map(buildNumericRow)
    const catRows = inputs.map(buildCategoricalRow)
    const numImp = numImputer.transform(numRows)
    const numSc = numScaler.transform(numImp)
    const catImp = catImputer.transform(catRows)
    const catEnc = catEncoder.transform(catImp)
    return hstack(numSc, catEnc)
  }

  function euclideanToCentroid(row: number[]): number {
    let sumSq = 0
    for (let j = 0; j < row.length; j++) {
      const d = row[j] - centroid[j]
      sumSq += d * d
    }
    return Math.sqrt(sumSq)
  }

  return {
    predict(inputs: PredictionInput[]) {
      if (inputs.length === 0) return []
      const X = transform(inputs)
      const raw = predictRidge(X, model)
      return raw.map((v) => Math.max(0, Math.min(10, v)))
    },
    predictWithDistance(inputs: PredictionInput[]) {
      if (inputs.length === 0) return { predictions: [], distances: [] }
      const X = transform(inputs)
      const raw = predictRidge(X, model)
      return {
        predictions: raw.map((v) => Math.max(0, Math.min(10, v))),
        distances: X.map(euclideanToCentroid),
      }
    },
    model,
    trainSize: trainInputs.length,
    featureNames,
    isStub: false,
  }
}

export { NUMERIC_FEATURE_NAMES, CATEGORICAL_FEATURE_NAMES }

/**
 * Out-of-fold predictions: pra cada item, qual seria a predição do Ridge
 * se ele *não estivesse* no conjunto de treino? Usado pelo stacker (final.ts)
 * pra evitar leakage — sem isso, ridgeScore == manualScore nas obras de
 * treino e o stacker decide overfit absurdo.
 *
 * Retorna `null` quando há poucas amostras pra fazer CV honesta. Caller deve
 * cair pro inverse-variance nesse caso.
 */
export function ridgeOutOfFoldPredictions(
  inputs: PredictionInput[],
  targets: number[],
  kFolds = 5,
): number[] | null {
  if (inputs.length !== targets.length) {
    throw new Error("ridgeOutOfFoldPredictions: inputs/targets length mismatch")
  }
  const n = inputs.length
  const MIN_FOR_OOF = 20
  if (n < MIN_FOR_OOF) return null

  // Mesmo critério de folds usado em trainPredictor: LOOCV abaixo de 50, k-fold acima.
  const effectiveK = Math.max(2, Math.min(kFolds, n))
  const useFolds = n < 50 ? n : effectiveK

  // Shuffle determinístico (mesma seed do RidgeCV em ridge.ts)
  const order = Array.from({ length: n }, (_, i) => i)
  let state = 42
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  const folds: number[][] = Array.from({ length: useFolds }, () => [])
  for (let i = 0; i < n; i++) folds[i % useFolds].push(order[i])

  const predictions = new Array<number>(n).fill(NaN)
  for (const fold of folds) {
    const testIdx = new Set(fold)
    const trainInputs: PredictionInput[] = []
    const trainTargets: number[] = []
    const testInputs: PredictionInput[] = []
    const testOrder: number[] = []
    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        testInputs.push(inputs[i])
        testOrder.push(i)
      } else {
        trainInputs.push(inputs[i])
        trainTargets.push(targets[i])
      }
    }
    if (trainInputs.length === 0 || testInputs.length === 0) continue
    const predictor = trainPredictor(trainInputs, trainTargets)
    if (predictor.isStub) {
      // Treino do fold é pequeno demais — usa fallback constante (mean),
      // nem é OOF honesto mas o stacker ainda funciona.
      const fallback =
        trainTargets.length > 0
          ? trainTargets.reduce((a, b) => a + b, 0) / trainTargets.length
          : 7.0
      for (const idx of testOrder) predictions[idx] = fallback
      continue
    }
    const preds = predictor.predict(testInputs)
    for (let i = 0; i < testOrder.length; i++) {
      predictions[testOrder[i]] = preds[i]
    }
  }

  return predictions
}
