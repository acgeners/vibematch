/**
 * "Chance de gostar" — Força 1 da Bússola (ver PLANO-BUSSOLA-3-FORCAS.md).
 *
 * Probabilidade calibrada (0–1) de que o usuário GOSTE da obra, definida como
 * P(user_score ≥ CHANCE_LIKED_THRESHOLD). É o eixo de FIT do plano 2D — separado
 * de "Avaliação" (crítica externa) e "Alcance" (popularidade).
 *
 * Modelo: logística L2 (lib/ml/logistic) sobre features de fit, com calibração
 * Platt sobre logits out-of-fold. Treinada só nas obras rotuladas (com user_score).
 *
 * Validação (2026-07-06, scripts/axis-gate.ts, n=206): AUC 0.73; robusta a
 * leakage — sem os sinais que dependem do perfil (personal_fit/Interesse), as
 * tags declaradas + category_scores sozinhas dão AUC 0.71. Ver
 * [[project_fit_merit_axis_gate]].
 *
 * NOTA DE ARQUITETURA: as prefs livres em texto (user_preference_rules, mig 102)
 * NÃO entram aqui — por design elas alimentam só o consultor LLM. Elas chegam à
 * Chance apenas via a feature `interesseOrdinal` (o Interesse-na-obra já as ingere).
 */

import { CRITERION_SLUGS, type CategoryScoreMap, type CriterionSlug } from "@/types/domain"
import { MedianImputer, StandardScaler, type NumericRow } from "@/lib/ml/preprocessing"
import { fitLogisticCV, logit, sigmoid, oofLogits, fitPlatt, type LogisticModel } from "@/lib/ml/logistic"

/** user_score ≥ este valor = "gostou" (o alvo binário). "Ponto forte" na escala pós-leitura. */
export const CHANCE_LIKED_THRESHOLD = 8
const MIN_TRAIN = 20

export interface ChanceInput {
  /** 9 notas de conteúdo da IA. */
  categoryScores: CategoryScoreMap
  /** Fração das tags da obra marcadas "amo" (user_tag_preferences). null → imputado. */
  declaredLovedFrac: number | null
  /** Fração das tags da obra marcadas "evito". */
  declaredAvoidedFrac: number | null
  /** Alinhamento determinístico com o perfil (calculated_scores.personal_fit). */
  personalFit: number | null
  /** Interesse-na-obra em ordinal 1–4 (bandas ♥). Carrega sinopse+reviews+digest+prefs livres. */
  interesseOrdinal: number | null
}

const FEATURE_NAMES = [
  ...CRITERION_SLUGS,
  "DeclaredLoved",
  "DeclaredAvoided",
  "PersonalFit",
  "Interesse",
] as const

function buildRow(input: ChanceInput): NumericRow {
  const row: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) {
    const v = input.categoryScores[slug as CriterionSlug]
    row.push(v == null || !Number.isFinite(v) ? null : v)
  }
  row.push(input.declaredLovedFrac ?? null)
  row.push(input.declaredAvoidedFrac ?? null)
  row.push(input.personalFit ?? null)
  row.push(input.interesseOrdinal ?? null)
  return row
}

export interface TrainedChancePredictor {
  /** Probabilidade calibrada 0–1 de gostar. */
  predict(inputs: ChanceInput[]): number[]
  /** Mesma coisa em escala 0–100 (a "Chance de gostar" exibida). */
  predictScore(inputs: ChanceInput[]): number[]
  model: LogisticModel
  platt: { A: number; B: number }
  featureNames: string[]
  trainSize: number
  /** Fração de rótulos positivos no treino (base rate). Fallback do stub. */
  baseRate: number
  cvAUC: number
  cvLogLoss: number
  isStub: boolean
}

/**
 * Treina o preditor de Chance. `labels01[i]` = 1 se o usuário gostou da obra i
 * (tipicamente `user_score ≥ CHANCE_LIKED_THRESHOLD`), 0 caso contrário.
 * Abaixo de MIN_TRAIN rótulos, retorna um stub que devolve a base rate.
 */
export function trainChancePredictor(inputs: ChanceInput[], labels01: number[]): TrainedChancePredictor {
  if (inputs.length !== labels01.length) {
    throw new Error("trainChancePredictor: inputs and labels length mismatch")
  }
  const baseRate = labels01.length ? labels01.reduce((a, b) => a + b, 0) / labels01.length : 0.5

  if (inputs.length < MIN_TRAIN) {
    return {
      predict: (rows) => rows.map(() => baseRate),
      predictScore: (rows) => rows.map(() => baseRate * 100),
      model: { coefficients: [], intercept: 0, lambda: 0, cvAUC: 0.5, cvLogLoss: 0 },
      platt: { A: 1, B: 0 },
      featureNames: [...FEATURE_NAMES],
      trainSize: inputs.length,
      baseRate,
      cvAUC: 0.5,
      cvLogLoss: 0,
      isStub: true,
    }
  }

  const rows = inputs.map(buildRow)
  const imputer = new MedianImputer().fit(rows)
  const imputed = imputer.transform(rows)
  const scaler = new StandardScaler().fit(imputed)
  const X = scaler.transform(imputed)

  const model = fitLogisticCV(X, labels01)
  // Calibração Platt sobre logits OOF (sem leakage do próprio ponto).
  const platt = fitPlatt(oofLogits(X, labels01, model.lambda), labels01)

  const transform = (batch: ChanceInput[]) => scaler.transform(imputer.transform(batch.map(buildRow)))
  const calibrated = (x: number[]) => sigmoid(platt.A * logit(x, model) + platt.B)

  return {
    predict: (batch) => (batch.length ? transform(batch).map(calibrated) : []),
    predictScore: (batch) => (batch.length ? transform(batch).map((x) => 100 * calibrated(x)) : []),
    model,
    platt,
    featureNames: [...FEATURE_NAMES],
    trainSize: inputs.length,
    baseRate,
    cvAUC: model.cvAUC,
    cvLogLoss: model.cvLogLoss,
    isStub: false,
  }
}

export { FEATURE_NAMES as CHANCE_FEATURE_NAMES, MIN_TRAIN as MIN_TRAIN_CHANCE }
