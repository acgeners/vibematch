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
  "♥": 3,
  "♥♥": 6,
  "♥♥♥": 8,
  "♥♥♥♥": 10,
}

const NUMERIC_FEATURE_NAMES = [
  ...CRITERION_SLUGS,
  "IA(n)",
  "Nota.M",
  "LogVotos",
  "Cps.N",
  "SinopseScore",
  "ObsAdjustment",
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
}

export interface TrainedPredictor {
  predict(inputs: PredictionInput[]): number[]
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
  const model = fitRidgeCV(Xtrain, trainTargets)

  const featureNames = [
    ...NUMERIC_FEATURE_NAMES,
    ...catEncoder.featureNames(CATEGORICAL_FEATURE_NAMES as unknown as string[]),
  ]

  return {
    predict(inputs: PredictionInput[]) {
      if (inputs.length === 0) return []
      const numRows = inputs.map(buildNumericRow)
      const catRows = inputs.map(buildCategoricalRow)
      const numImp = numImputer.transform(numRows)
      const numSc = numScaler.transform(numImp)
      const catImp = catImputer.transform(catRows)
      const catEnc = catEncoder.transform(catImp)
      const X = hstack(numSc, catEnc)
      const raw = predictRidge(X, model)
      return raw.map((v) => Math.max(0, Math.min(10, Math.round(v * 10) / 10)))
    },
    model,
    trainSize: trainInputs.length,
    featureNames,
    isStub: false,
  }
}

export { NUMERIC_FEATURE_NAMES, CATEGORICAL_FEATURE_NAMES }
