/**
 * Calibração automática dos parâmetros do formula_config.
 *
 * Replica as colunas auxiliares AI–AN da planilha MANHWAS.xlsx:
 *   - mae_calc      = avg |Nota.Calc - M.Nota|  (linhas com M.Nota)
 *   - mae_predicted = avg |Nota.Pr   - M.Nota|
 *   - mae_final     = avg |NotaFinal - M.Nota|  (informativo, não vai pro config)
 *   - pseudo_votes_nota_m  = percentile 75% de #Votos
 *   - pseudo_votes_blend   = percentile 60% de #Votos
 */

import { percentile } from "@/lib/ml/preprocessing"

export interface CalibrationDiff {
  workId: string
  title?: string
  manualScore: number
  calcScore: number | null
  predictedScore: number | null
  finalScore: number | null
  diffCalc: number | null
  diffPredicted: number | null
  diffFinal: number | null
}

export interface CalibrationResult {
  /** Quantidade de títulos com manual_score preenchido (treino + validação). */
  trainSize: number
  maeCalc: number
  maePredicted: number
  maeFinal: number
  /** Percentile 75% de #Votos sobre todos os títulos com votos > 0 */
  pseudoVotesNotaM: number
  /** Percentile 60% de #Votos */
  pseudoVotesBlend: number
  /** Top-N piores diffs (para debug/inspeção). Null se trainSize = 0. */
  worstDiffs: CalibrationDiff[]
}

const PERCENTILE_NOTA_M = 0.75
const PERCENTILE_BLEND = 0.60

/** Defaults que vieram da planilha original — usados quando dados são insuficientes. */
const FALLBACK = {
  maeCalc: 1.2657,
  maePredicted: 0.9246,
  maeFinal: 0.98,
  pseudoVotesNotaM: 1767,
  pseudoVotesBlend: 1024,
}

const MIN_TRAIN_FOR_MAE = 5

export interface CalibrationInput {
  workId: string
  title?: string
  manualScore: number | null
  calcScore: number | null
  predictedScore: number | null
  finalScore: number | null
  totalVotes: number
}

function meanAbs(diffs: number[]): number {
  if (diffs.length === 0) return 0
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
}

export function computeCalibration(items: CalibrationInput[]): CalibrationResult {
  const withManual = items.filter((it) => it.manualScore != null)

  const diffsCalc: number[] = []
  const diffsPredicted: number[] = []
  const diffsFinal: number[] = []
  const allDiffs: CalibrationDiff[] = []

  for (const it of withManual) {
    const m = it.manualScore as number
    const dCalc = it.calcScore != null ? Math.abs(it.calcScore - m) : null
    const dPr = it.predictedScore != null ? Math.abs(it.predictedScore - m) : null
    const dFin = it.finalScore != null ? Math.abs(it.finalScore - m) : null
    if (dCalc != null) diffsCalc.push(dCalc)
    if (dPr != null) diffsPredicted.push(dPr)
    if (dFin != null) diffsFinal.push(dFin)
    allDiffs.push({
      workId: it.workId,
      title: it.title,
      manualScore: m,
      calcScore: it.calcScore,
      predictedScore: it.predictedScore,
      finalScore: it.finalScore,
      diffCalc: dCalc,
      diffPredicted: dPr,
      diffFinal: dFin,
    })
  }

  const votes = items.map((it) => it.totalVotes).filter((v) => v > 0)

  const maeCalc =
    diffsCalc.length >= MIN_TRAIN_FOR_MAE ? meanAbs(diffsCalc) : FALLBACK.maeCalc
  const maePredicted =
    diffsPredicted.length >= MIN_TRAIN_FOR_MAE
      ? meanAbs(diffsPredicted)
      : FALLBACK.maePredicted
  const maeFinal =
    diffsFinal.length >= MIN_TRAIN_FOR_MAE ? meanAbs(diffsFinal) : FALLBACK.maeFinal

  const pseudoVotesNotaM =
    votes.length >= 5 ? percentile(votes, PERCENTILE_NOTA_M) : FALLBACK.pseudoVotesNotaM
  const pseudoVotesBlend =
    votes.length >= 5 ? percentile(votes, PERCENTILE_BLEND) : FALLBACK.pseudoVotesBlend

  // Mantém apenas alguns piores diffs pra inspeção
  const worstDiffs = allDiffs
    .filter((d) => d.diffFinal != null)
    .sort((a, b) => (b.diffFinal ?? 0) - (a.diffFinal ?? 0))
    .slice(0, 10)

  return {
    trainSize: withManual.length,
    maeCalc: Number(maeCalc.toFixed(4)),
    maePredicted: Number(maePredicted.toFixed(4)),
    maeFinal: Number(maeFinal.toFixed(4)),
    // Garantir mínimos pra evitar instabilidade numérica
    pseudoVotesNotaM: Math.max(1, Math.round(pseudoVotesNotaM * 10) / 10),
    pseudoVotesBlend: Math.max(1, Math.round(pseudoVotesBlend * 10) / 10),
    worstDiffs,
  }
}
