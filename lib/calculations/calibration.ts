/**
 * Calibração automática dos parâmetros do formula_config.
 *
 * Calcula MAE (display) e RMSE (usado em 1/RMSE² no peso de Nota.Final):
 *   - mae_calc / rmse_calc      = resíduos de Nota.Calc vs M.Nota
 *   - mae_predicted / rmse_pred = resíduos de Nota.Pr vs M.Nota
 *   - mae_final / rmse_final    = informativo
 *   - pseudo_votes_nota_m       = percentile 75% de #Votos
 *   - pseudo_votes_blend        = percentile 60% de #Votos
 *
 * Quando há menos de MIN_TRAIN_FOR_MAE amostras com diff, os valores
 * retornam `null` — o consumer (Nota.Final) cai pra Nota.Calc puro
 * em vez de blend com peso baseado em chute.
 */

import { percentile } from "@/lib/ml/preprocessing"

export interface CalibrationDiff {
  workId: string
  title?: string
  userScore: number
  calcScore: number | null
  predictedScore: number | null
  finalScore: number | null
  diffCalc: number | null
  diffPredicted: number | null
  diffFinal: number | null
}

export interface CalibrationResult {
  /** Quantidade de títulos com user_score preenchido (treino + validação). */
  trainSize: number
  maeCalc: number | null
  maePredicted: number | null
  maeFinal: number | null
  rmseCalc: number | null
  rmsePredicted: number | null
  rmseFinal: number | null
  /** Percentile 75% de #Votos sobre todos os títulos com votos > 0 */
  pseudoVotesNotaM: number | null
  /** Percentile 60% de #Votos */
  pseudoVotesBlend: number | null
  /** Top-N piores diffs (para debug/inspeção). */
  worstDiffs: CalibrationDiff[]
}

/**
 * Pseudo-votes derivam da mediana com multiplicador fixo (mais robusto a
 * outliers que P75/P60, que oscilam quando a base ganha muitos títulos
 * populares de uma vez).
 *
 * Multiplicadores escolhidos pra reproduzir aproximadamente o comportamento
 * anterior em distribuições típicas: mediana × 2 ≈ P75; mediana × 1.2 ≈ P60.
 */
const PSEUDO_VOTES_NOTA_M_MULT = 2.0
const PSEUDO_VOTES_BLEND_MULT = 1.2

const MIN_TRAIN_FOR_MAE = 20
const MIN_VOTES_FOR_PERCENTILE = 5

export interface CalibrationInput {
  workId: string
  title?: string
  userScore: number | null
  calcScore: number | null
  predictedScore: number | null
  finalScore: number | null
  totalVotes: number
}

/**
 * Análise de erro por faixa de distância ao centróide e por faixa de votos.
 *
 * Responde "onde o sistema acerta menos pra obras novas?". Obras com alta
 * distância ou poucos votos são proxies pro perfil típico de obra ainda
 * sem nota pessoal — se o MAE for muito pior nesses buckets, há ganho
 * potencial em confidence-weighting per-instance.
 */
export interface BucketBreakdownEntry {
  label: string
  count: number
  /** MAE da Nota Prevista (expected_score) no bucket (null se < MIN_BUCKET_SIZE). */
  mae: number | null
}

export interface BucketBreakdown {
  byDistance: BucketBreakdownEntry[]
  byVotes: BucketBreakdownEntry[]
}

export interface BucketInput extends CalibrationInput {
  predictionDistance: number | null
  /** Nota Prevista (expected_score) — métrica do bucket pós-remoção do legado. */
  expectedScore: number | null
}

const DISTANCE_BUCKETS = [
  { label: "< 3", min: 0, max: 3 },
  { label: "3–6", min: 3, max: 6 },
  { label: "≥ 6", min: 6, max: Infinity },
] as const

const VOTES_BUCKETS = [
  { label: "< 100", min: 0, max: 100 },
  { label: "100–1k", min: 100, max: 1_000 },
  { label: "1k–10k", min: 1_000, max: 10_000 },
  { label: "≥ 10k", min: 10_000, max: Infinity },
] as const

// Buckets com menos que isso viram "sem amostra" (mae=null) em vez de mostrar
// um MAE confiante sobre 5-9 obras, que é essencialmente ruído.
const MIN_BUCKET_SIZE = 10

function bucketMae(
  items: BucketInput[],
  predicate: (it: BucketInput) => boolean,
): { count: number; mae: number | null } {
  const filtered = items.filter(
    (it) =>
      predicate(it) && it.userScore != null && it.expectedScore != null,
  )
  if (filtered.length < MIN_BUCKET_SIZE) {
    return { count: filtered.length, mae: null }
  }
  const diffs = filtered.map((it) =>
    Math.abs((it.expectedScore as number) - (it.userScore as number)),
  )
  return { count: filtered.length, mae: round4(meanAbs(diffs)) }
}

export function computeBucketBreakdown(items: BucketInput[]): BucketBreakdown {
  const byDistance: BucketBreakdownEntry[] = DISTANCE_BUCKETS.map((b) => {
    const { count, mae } = bucketMae(
      items,
      (it) =>
        it.predictionDistance != null &&
        it.predictionDistance >= b.min &&
        it.predictionDistance < b.max,
    )
    return { label: b.label, count, mae }
  })
  const byVotes: BucketBreakdownEntry[] = VOTES_BUCKETS.map((b) => {
    const { count, mae } = bucketMae(
      items,
      (it) => it.totalVotes >= b.min && it.totalVotes < b.max,
    )
    return { label: b.label, count, mae }
  })
  return { byDistance, byVotes }
}

function meanAbs(diffs: number[]): number {
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
}

function rmse(signedDiffs: number[]): number {
  const sumSq = signedDiffs.reduce((a, b) => a + b * b, 0)
  return Math.sqrt(sumSq / signedDiffs.length)
}

function round4(v: number): number {
  return Number(v.toFixed(4))
}

export function computeCalibration(items: CalibrationInput[]): CalibrationResult {
  const withManual = items.filter((it) => it.userScore != null)

  const signedDiffsCalc: number[] = []
  const signedDiffsPredicted: number[] = []
  const signedDiffsFinal: number[] = []
  const allDiffs: CalibrationDiff[] = []

  for (const it of withManual) {
    const m = it.userScore as number
    const sCalc = it.calcScore != null ? it.calcScore - m : null
    const sPr = it.predictedScore != null ? it.predictedScore - m : null
    const sFin = it.finalScore != null ? it.finalScore - m : null
    if (sCalc != null) signedDiffsCalc.push(sCalc)
    if (sPr != null) signedDiffsPredicted.push(sPr)
    if (sFin != null) signedDiffsFinal.push(sFin)
    allDiffs.push({
      workId: it.workId,
      title: it.title,
      userScore: m,
      calcScore: it.calcScore,
      predictedScore: it.predictedScore,
      finalScore: it.finalScore,
      diffCalc: sCalc != null ? Math.abs(sCalc) : null,
      diffPredicted: sPr != null ? Math.abs(sPr) : null,
      diffFinal: sFin != null ? Math.abs(sFin) : null,
    })
  }

  const votes = items.map((it) => it.totalVotes).filter((v) => v > 0)

  const enoughCalc = signedDiffsCalc.length >= MIN_TRAIN_FOR_MAE
  const enoughPr = signedDiffsPredicted.length >= MIN_TRAIN_FOR_MAE
  const enoughFinal = signedDiffsFinal.length >= MIN_TRAIN_FOR_MAE

  const maeCalc = enoughCalc ? round4(meanAbs(signedDiffsCalc.map(Math.abs))) : null
  const maePredicted = enoughPr ? round4(meanAbs(signedDiffsPredicted.map(Math.abs))) : null
  const maeFinal = enoughFinal ? round4(meanAbs(signedDiffsFinal.map(Math.abs))) : null

  const rmseCalc = enoughCalc ? round4(rmse(signedDiffsCalc)) : null
  const rmsePredicted = enoughPr ? round4(rmse(signedDiffsPredicted)) : null
  const rmseFinal = enoughFinal ? round4(rmse(signedDiffsFinal)) : null

  const median =
    votes.length >= MIN_VOTES_FOR_PERCENTILE ? percentile(votes, 0.5) : null
  const pseudoVotesNotaM =
    median != null
      ? Math.max(1, Math.round(median * PSEUDO_VOTES_NOTA_M_MULT * 10) / 10)
      : null
  const pseudoVotesBlend =
    median != null
      ? Math.max(1, Math.round(median * PSEUDO_VOTES_BLEND_MULT * 10) / 10)
      : null

  const worstDiffs = allDiffs
    .filter((d) => d.diffFinal != null)
    .sort((a, b) => (b.diffFinal ?? 0) - (a.diffFinal ?? 0))
    .slice(0, 10)

  return {
    trainSize: withManual.length,
    maeCalc,
    maePredicted,
    maeFinal,
    rmseCalc,
    rmsePredicted,
    rmseFinal,
    pseudoVotesNotaM,
    pseudoVotesBlend,
    worstDiffs,
  }
}
