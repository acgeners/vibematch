/**
 * expected_score — L1 do pipeline novo (single Ridge + decomposição via atribuição).
 *
 * REVISÃO 2026-05-28: removidas as 8 features `post_*_score` do treino.
 * Motivo: elas só existem em obras LIDAS (treino), são median-imputadas em
 * obras não-lidas (inferência). O Ridge aprendia coefs altos (0.10-0.20)
 * delas porque correlacionam com `user_score` no treino (próximo a leak
 * de info), mas na inferência o valor imputado vira 0 após scaling →
 * contribuição zero. Resultado: predição cai no intercept ≈ 8.0 pra todas
 * as não-lidas, e os critérios IA + features do TasteProfile ficam com
 * coefs minúsculos porque o "budget" foi gasto nas post_*.
 *
 * Com post_* removidas, o Ridge é forçado a aprender via features que
 * EXISTEM tanto em treino quanto inferência → predições passam a variar
 * informativamente entre obras leves e dramáticas.
 *
 * Features (19 numéricas + 2 categóricas):
 *   Baseline / perfil (19):
 *     - 9 category_scores (preference axis)
 *     - IA(n) — engineered non-linear summary
 *     - Nota.M, LogVotos, Cps.N
 *     - SinopseScore
 *     - LovedTagOverlap, AvoidedTagOverlap, CriterionFitScore
 *     - ReleaseAge, RunLength (recência/era + duração)
 *   (ObsAdjustment removido — agora soma determinística pós-predição.)
 *   Quality (0):
 *     - (removidas — ver acima)
 *   Categóricas:
 *     - Status (one-hot)
 *     - Origin (ko/ja/zh/other — país de origem do título original)
 *
 * Decomposição pós-hoc continua válida — `qualityAdj` agora é sempre 0
 * (esperado), `baseline` é o único componente. Mantida a estrutura pra não
 * quebrar callers; UI pode esconder o waterfall quality quando soma zero.
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
import { fitRidgeCV, type RidgeModel } from "@/lib/ml/ridge"
import { normalizeChapters } from "./chapters"

const SINOPSE_MAP: Record<string, number> = {
  "♥": 2,
  "♥♥": 5,
  "♥♥♥": 8,
  "♥♥♥♥": 13,
}

// NOTA: `ObsAdjustment` foi REMOVIDO do Ridge (2026-05-29). Era padronizado e
// quase sempre 0 → coeficiente ruidoso que não correspondia ao ajuste manual
// que o usuário define. Agora é aplicado como soma determinística (±0.30) sobre
// a Nota Esperada em `recalculateAll` (server/actions/calculations.ts), igual ao
// comportamento do legado Nota.Calc. `ExpectedScoreInput.observationAdjustment`
// continua existindo, mas não entra mais em `buildNumericRow`.
const BASELINE_NUMERIC_FEATURES = [
  ...CRITERION_SLUGS,
  "IA(n)",
  "Nota.M",
  "LogVotos",
  "Cps.N",
  "SinopseScore",
  "LovedTagOverlap",
  "AvoidedTagOverlap",
  "CriterionFitScore",
  // Recência/era e duração da obra. Sinal ortogonal (não está nas 9 notas):
  // idade = ano atual − ano de início; duração = ano_fim − ano_início.
  "ReleaseAge",
  "RunLength",
] as const

// Mantido exportado pra backwards-compat: outros módulos consomem o nome.
// `ExpectedScoreInput.postScores` continua aceitando o map — apenas não é
// usado no buildNumericRow (excluído do treino do Ridge).
export const POST_SCORE_FIELDS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

export type PostScoreField = (typeof POST_SCORE_FIELDS)[number]

// QUALITY features REMOVIDAS do treino do Ridge — ver doc-comment no topo.
// Array vazio mantém a estrutura BASELINE+QUALITY de índices/decomposição
// sem ter que mudar callers; qualityAdj passa a ser sempre 0.
const QUALITY_NUMERIC_FEATURES = [] as const

const NUMERIC_FEATURE_NAMES = [
  ...BASELINE_NUMERIC_FEATURES,
  ...QUALITY_NUMERIC_FEATURES,
] as const

// Origin = país de origem inferido do título original (ko/ja/zh/other). Sinal de
// preferência de mídia (manhwa coreano vs mangá japonês vs manhua chinês).
const CATEGORICAL_FEATURE_NAMES = ["Status", "Origin"] as const

const MIN_TRAIN = 20

// Quais índices do feature vector pertencem a cada grupo (pra decomposição).
// Categorical (Status one-hot) é considerado baseline. O tamanho dos blocos
// baseline e quality é dinâmico por treino (includeArt / includeQuality) — a
// contagem vive dentro de `trainExpectedPredictor`.

export interface ExpectedScoreInput {
  // Baseline / perfil
  categoryScores: CategoryScoreMap
  iaEvalNormalized: number | null
  platformAvg: number | null
  totalVotes: number
  totalChapters: number | null
  synopsisQuality: string | null
  observationAdjustment: number
  publicationStatus: string
  lovedTagOverlap: number | null
  avoidedTagOverlap: number | null
  criterionFitScore: number | null
  /** Idade da obra (ano atual − ano de início). null quando sem ano. */
  releaseAge: number | null
  /** Duração (ano_fim − ano_início). null quando sem anos. */
  runLength: number | null
  /** Origem inferida do título original: "ko" | "ja" | "zh" | "other" | "unknown". */
  origin: string
  // Quality (8 granulares; null pra obras não lidas → imputado pela mediana)
  postScores: Partial<Record<PostScoreField, number | null>>
  /**
   * EXPERIMENTAL — estimativa 0–10 da nota de arte, produzida por um modelo barato
   * (tags + digest + léxico). Só entra no Ridge quando `includeArt` é ligado; sem o flag
   * o campo é ignorado e o vetor de features é byte-idêntico ao de produção.
   *
   * 🔴 Quem preencher isto TEM que usar estimativa OUT-OF-FOLD. O rótulo de arte
   * (`like_art_score`) é 1/7 do `user_score` que o Ridge prevê, nas MESMAS obras —
   * uma estimativa in-sample põe 1/7 do alvo dentro das features e infla o ganho.
   */
  artEstimate?: number | null
}

export interface ExpectedDecomposition {
  /** intercept + Σ baseline contributions + Σ Status contributions. */
  baseline: number
  /** Σ quality contributions (residual sobre baseline). */
  qualityAdj: number
  /** clamp(baseline + qualityAdj, 0, 10). */
  expected: number
  /**
   * True quando NENHUMA das 8 post-scores está preenchida (obra não lida).
   * Mantido por compatibilidade com UI 2-stage; com single Ridge, qualityAdj
   * pode ser ≠ 0 mesmo aqui (vem dos valores imputados pela mediana).
   */
  qualityAdjFromImputation: boolean
}

export interface ExpectedPredictionResult {
  predictions: ExpectedDecomposition[]
  /** Distância euclidiana ao centróide do treino (todas as features). */
  distances: number[]
}

export interface TrainedExpectedPredictor {
  predict(inputs: ExpectedScoreInput[]): ExpectedDecomposition[]
  predictWithDistance(inputs: ExpectedScoreInput[]): ExpectedPredictionResult
  /** Modelo Ridge único com todas as 22 features + Status one-hot. */
  model: RidgeModel
  /** Nomes alinhados com coefficients: [...baseline, ...quality, ...status_oh]. */
  featureNames: string[]
  /** Índices dos features de baseline (incl. Status one-hot) no vetor. */
  baselineIndices: number[]
  /** Índices dos features de quality no vetor. */
  qualityIndices: number[]
  trainSize: number
  /** Quantos training samples tinham ≥ 1 post-score preenchido (info diagnóstica). */
  trainWithPostScores: number
  isStub: boolean
}

function buildNumericRow(
  input: ExpectedScoreInput,
  includeQuality = false,
  includeArt = false,
): NumericRow {
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
  // ObsAdjustment removido do Ridge — agora é soma determinística pós-predição.
  row.push(input.lovedTagOverlap ?? null)
  row.push(input.avoidedTagOverlap ?? null)
  row.push(input.criterionFitScore ?? null)
  row.push(input.releaseAge ?? null)
  row.push(input.runLength ?? null)
  // ArtEstimate entra no BLOCO BASELINE (logo após RunLength) pra não deslocar os
  // índices de quality/one-hot da decomposição. Ver `artEstimate` no input.
  if (includeArt) {
    const a = input.artEstimate
    row.push(a == null || !Number.isFinite(a) ? null : a)
  }
  // post_*_score (8 quality) — só entram no Ridge no plano Pago (L0+), quando
  // existem pra TODA obra (user pós-leitura OU estimativa IA pras não-lidas).
  // No Free ficam de fora (imputação→colapso nas não-lidas). Ver doc-comment.
  if (includeQuality) {
    for (const field of POST_SCORE_FIELDS) {
      const v = input.postScores[field]
      row.push(v == null || !Number.isFinite(v) ? null : v)
    }
  }
  return row
}

function buildCategoricalRow(input: ExpectedScoreInput): string[] {
  return [input.publicationStatus || "Unknown", input.origin || "unknown"]
}

function hasAnyPostScore(input: ExpectedScoreInput): boolean {
  for (const field of POST_SCORE_FIELDS) {
    const v = input.postScores[field]
    if (v != null && Number.isFinite(v)) return true
  }
  return false
}

export function trainExpectedPredictor(
  trainInputs: ExpectedScoreInput[],
  trainTargets: number[],
  includeQuality = false,
  includeArt = false,
): TrainedExpectedPredictor {
  if (trainInputs.length !== trainTargets.length) {
    throw new Error("trainExpectedPredictor: inputs and targets length mismatch")
  }

  // Feature set numérico depende do plano: Pago (includeQuality) adiciona os
  // 8 quality granulares; Free fica só nos 14 baseline.
  const baselineFeatureNames: readonly string[] = includeArt
    ? [...BASELINE_NUMERIC_FEATURES, "ArtEstimate"]
    : BASELINE_NUMERIC_FEATURES
  const baselineCount = baselineFeatureNames.length
  const qualityFeatureNames: readonly string[] = includeQuality ? POST_SCORE_FIELDS : []
  const numericFeatureNames = [...baselineFeatureNames, ...qualityFeatureNames]
  const qualityCount = qualityFeatureNames.length

  // Stub fallback
  if (trainInputs.length < MIN_TRAIN) {
    const fallbackMean =
      trainTargets.length > 0
        ? trainTargets.reduce((a, b) => a + b, 0) / trainTargets.length
        : 7.0
    return {
      predict: (rows) =>
        rows.map(() => ({
          baseline: fallbackMean,
          qualityAdj: 0,
          expected: fallbackMean,
          qualityAdjFromImputation: false,
        })),
      predictWithDistance: (rows) => ({
        predictions: rows.map(() => ({
          baseline: fallbackMean,
          qualityAdj: 0,
          expected: fallbackMean,
          qualityAdjFromImputation: false,
        })),
        distances: rows.map(() => 0),
      }),
      model: { coefficients: [], intercept: fallbackMean, alpha: 0, cvMAE: 0, cvRMSE: 0 },
      featureNames: [],
      baselineIndices: [],
      qualityIndices: [],
      trainSize: trainInputs.length,
      trainWithPostScores: 0,
      isStub: true,
    }
  }

  const numericRows = trainInputs.map((inp) => buildNumericRow(inp, includeQuality, includeArt))
  const categoricalRows = trainInputs.map(buildCategoricalRow)

  const numImputer = new MedianImputer().fit(numericRows)
  const numImputed = numImputer.transform(numericRows)
  const numScaler = new StandardScaler().fit(numImputed)
  const numScaled = numScaler.transform(numImputed)

  const catImputer = new CategoricalImputer().fit(categoricalRows)
  const catImputed = catImputer.transform(categoricalRows)
  const catEncoder = new OneHotEncoder().fit(catImputed)
  const catEncoded = catEncoder.transform(catImputed)

  const Xtrain = hstack(numScaled, catEncoded)
  // k FIXO. Antes: `n < 50 ? n : 5` — ou seja, LOOCV (n folds) abaixo de 50 rótulos.
  // A intenção era boa (com poucos rótulos, LOOCV estima melhor), mas o custo é O(n²):
  // `fitRidgeCV` roda 9 alphas × n folds, e isto ainda é chamado DENTRO da CV aninhada
  // da MAE honesta. Como a MAE honesta exige n ≥ 30, a faixa 30–49 virava o caso MAIS
  // caro do sistema — exatamente onde todo usuário novo vai viver. Ver
  // PLANO-MULTIUSER-FASE2.md §8.2.
  const cvFolds = Math.min(5, trainInputs.length)
  const model = fitRidgeCV(Xtrain, trainTargets, undefined, cvFolds)

  // Índices do feature vector:
  //   [0 .. BASELINE_COUNT)                                          → baseline numéricas
  //   [BASELINE_COUNT .. BASELINE_COUNT + QUALITY_COUNT)             → quality numéricas
  //   [BASELINE_COUNT + QUALITY_COUNT .. featureDim)                 → Status one-hot (baseline)
  const featureDim = Xtrain[0]?.length ?? 0
  const baselineIndices: number[] = []
  for (let i = 0; i < baselineCount; i++) baselineIndices.push(i)
  for (let i = baselineCount + qualityCount; i < featureDim; i++) baselineIndices.push(i)
  const qualityIndices: number[] = []
  for (let i = baselineCount; i < baselineCount + qualityCount; i++) qualityIndices.push(i)

  // Centróide do treino pra distance factor
  const centroid = new Array<number>(featureDim).fill(0)
  for (const row of Xtrain) {
    for (let j = 0; j < featureDim; j++) centroid[j] += row[j]
  }
  for (let j = 0; j < featureDim; j++) centroid[j] /= Xtrain.length

  const featureNames = [
    ...numericFeatureNames,
    ...catEncoder.featureNames(CATEGORICAL_FEATURE_NAMES as unknown as string[]),
  ]

  let trainWithPostScores = 0
  for (const input of trainInputs) {
    if (hasAnyPostScore(input)) trainWithPostScores += 1
  }

  function transform(inputs: ExpectedScoreInput[]): number[][] {
    const numRows = inputs.map((inp) => buildNumericRow(inp, includeQuality, includeArt))
    const catRows = inputs.map(buildCategoricalRow)
    const numImp = numImputer.transform(numRows)
    const numSc = numScaler.transform(numImp)
    const catImp = catImputer.transform(catRows)
    const catEnc = catEncoder.transform(catImp)
    return hstack(numSc, catEnc)
  }

  /**
   * Decomposição via atribuição linear:
   *   intercept + Σ (coef × x) por grupo de features.
   * Clamp final em [0, 10] aplicado SÓ no expected total — baseline e
   * qualityAdj individuais podem ficar fora do range, refletindo a soma real
   * antes do clamp (útil pra interpretação no waterfall).
   */
  function decompose(x: number[], input: ExpectedScoreInput): ExpectedDecomposition {
    const coefs = model.coefficients
    let baselineContribution = 0
    for (const i of baselineIndices) {
      baselineContribution += coefs[i] * x[i]
    }
    let qualityContribution = 0
    for (const i of qualityIndices) {
      qualityContribution += coefs[i] * x[i]
    }
    const baseline = model.intercept + baselineContribution
    const qualityAdj = qualityContribution
    const expected = Math.max(0, Math.min(10, baseline + qualityAdj))
    return {
      baseline,
      qualityAdj,
      expected,
      qualityAdjFromImputation: !hasAnyPostScore(input),
    }
  }

  function predictBatch(inputs: ExpectedScoreInput[]): ExpectedDecomposition[] {
    if (inputs.length === 0) return []
    const X = transform(inputs)
    return inputs.map((input, i) => decompose(X[i], input))
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
    predict: predictBatch,
    predictWithDistance(inputs) {
      if (inputs.length === 0) return { predictions: [], distances: [] }
      const X = transform(inputs)
      const predictions = inputs.map((input, i) => decompose(X[i], input))
      return { predictions, distances: X.map(euclideanToCentroid) }
    },
    model,
    featureNames,
    baselineIndices,
    qualityIndices,
    trainSize: trainInputs.length,
    trainWithPostScores,
    isStub: false,
  }
}

/**
 * Sanity-check helper pra cli/tests: pra cada predição, verifica que
 * `intercept + Σ contributions ≈ predição linear (pré-clamp)`. Útil pra
 * validar que baselineIndices + qualityIndices cobrem TODOS os índices do
 * vetor de features sem duplicação.
 */
export function verifyDecompositionCovers(predictor: TrainedExpectedPredictor): boolean {
  if (predictor.isStub) return true
  const covered = new Set<number>([...predictor.baselineIndices, ...predictor.qualityIndices])
  const expectedSize = predictor.model.coefficients.length
  if (covered.size !== expectedSize) return false
  for (let i = 0; i < expectedSize; i++) {
    if (!covered.has(i)) return false
  }
  return true
}

/**
 * Out-of-fold predictions do expected_score: pra cada item, qual seria o
 * `.expected` se a obra NÃO estivesse no treino. Usado pra fitar o peso do blend
 * expected⊕calc sem leakage — sem OOF, o Ridge memoriza as obras de treino e o
 * peso do blend sairia enviesado pro Ridge (que parece perfeito in-sample).
 *
 * OOF honesto (sem leakage): shuffle
 * determinístico (seed 42), LOOCV abaixo de 50. Retorna null com n < 20.
 */
export function expectedOutOfFoldPredictions(
  inputs: ExpectedScoreInput[],
  targets: number[],
  includeQuality = false,
  kFolds = 5,
  includeArt = false,
): number[] | null {
  if (inputs.length !== targets.length) {
    throw new Error("expectedOutOfFoldPredictions: inputs/targets length mismatch")
  }
  const n = inputs.length
  if (n < 20) return null
  // k FIXO (ver `trainExpectedPredictor`): sem isto, 30–49 rótulos = LOOCV, e cada fold
  // re-treina o preditor inteiro.
  const useFolds = Math.max(2, Math.min(kFolds, n))

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

  const preds = new Array<number>(n).fill(NaN)
  for (const fold of folds) {
    const testIdx = new Set(fold)
    const trIn: ExpectedScoreInput[] = []
    const trTg: number[] = []
    const teIn: ExpectedScoreInput[] = []
    const teOrder: number[] = []
    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        teIn.push(inputs[i])
        teOrder.push(i)
      } else {
        trIn.push(inputs[i])
        trTg.push(targets[i])
      }
    }
    if (trIn.length === 0 || teIn.length === 0) continue
    const predictor = trainExpectedPredictor(trIn, trTg, includeQuality, includeArt)
    if (predictor.isStub) {
      const fallback = trTg.length > 0 ? trTg.reduce((a, b) => a + b, 0) / trTg.length : 7.0
      for (const idx of teOrder) preds[idx] = fallback
      continue
    }
    const out = predictor.predict(teIn)
    for (let i = 0; i < teOrder.length; i++) preds[teOrder[i]] = out[i].expected
  }
  return preds
}

export {
  BASELINE_NUMERIC_FEATURES as EXPECTED_BASELINE_FEATURES,
  QUALITY_NUMERIC_FEATURES as EXPECTED_QUALITY_FEATURES,
  NUMERIC_FEATURE_NAMES as EXPECTED_NUMERIC_FEATURES,
  CATEGORICAL_FEATURE_NAMES as EXPECTED_CATEGORICAL_FEATURES,
  MIN_TRAIN as MIN_TRAIN_EXPECTED,
}
