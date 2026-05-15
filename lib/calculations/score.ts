import type { PublicationStatus, SynopsisQuality } from "@/types/domain"

const STATUS_MULTIPLIER: Record<string, number> = {
  Completed: 1.01,
  Ongoing: 0.995,
  Hiatus: 0.95,
  Cancelled: 0.98,
  Unknown: 0.98,
}

const SYNOPSIS_MULTIPLIER: Record<string, number> = {
  "♥♥♥♥": 1.04,
  "♥♥♥": 1.025,
  "♥♥": 1.01,
  "♥": 0.985,
}

export interface NotaCalcInputs {
  iaEvalNormalized: number
  platformAvg: number | null
  totalVotes: number
  chaptersNormalized: number
  publicationStatus: PublicationStatus
  synopsisQuality: SynopsisQuality | null
  observationAdjustment: number
  /** sqrt(pseudo_votes) para o blend IA(n) vs Nota.M */
  pseudoVotesBlend: number
}

/**
 * Nota.IA — score determinístico principal.
 *
 * 1. Blend entre IA(n) e Nota.M usando sqrt dos votos como peso
 * 2. Multiplica por bônus de capítulos: (1 + Cps.N / 200)
 * 3. Multiplica por fator de status
 * 4. Multiplica por fator de sinopse
 * 5. Soma Obs adjustment em pontos de nota, clamp ∈ [-0.30, +0.30]
 *    (positivo = bônus, negativo = penalidade)
 * 6. Clamp 0–10
 */
export function calculateNotaCalc(inputs: NotaCalcInputs): number {
  const {
    iaEvalNormalized,
    platformAvg,
    totalVotes,
    chaptersNormalized,
    publicationStatus,
    synopsisQuality,
    observationAdjustment,
    pseudoVotesBlend,
  } = inputs

  const sqrtVotes = Math.sqrt(Math.max(totalVotes, 0))
  const sqrtPseudo = Math.sqrt(Math.max(pseudoVotesBlend, 1))
  const denominator = sqrtVotes + sqrtPseudo

  let blend: number
  if (platformAvg != null && denominator > 0) {
    const wIA = sqrtPseudo / denominator
    const wPlatform = sqrtVotes / denominator
    blend = iaEvalNormalized * wIA + platformAvg * wPlatform
  } else {
    blend = iaEvalNormalized
  }

  const chapterBonus = 1 + chaptersNormalized / 200
  const statusMult = STATUS_MULTIPLIER[publicationStatus] ?? 0.98
  const synopsisMult = synopsisQuality
    ? (SYNOPSIS_MULTIPLIER[synopsisQuality] ?? 1)
    : 1
  const obsAdjustment = Math.min(Math.max(observationAdjustment, -0.30), 0.30)

  const result =
    blend * chapterBonus * statusMult * synopsisMult + obsAdjustment

  return Math.max(0, Math.min(10, result))
}
