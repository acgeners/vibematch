import type { SynopsisQuality } from "@/types/domain"

// Curva côncava-pra-cima: cada degrau salta mais que o anterior
// (+2pp, +2.5pp, +3.5pp) para premiar progressivamente o interesse alto.
const SYNOPSIS_MULTIPLIER: Record<string, number> = {
  "♥♥♥♥": 1.07,
  "♥♥♥": 1.035,
  "♥♥": 1.01,
  "♥": 0.99,
}

export interface NotaCalcInputs {
  iaEvalNormalized: number
  platformAvg: number | null
  totalVotes: number
  synopsisQuality: SynopsisQuality | null
  observationAdjustment: number
  /** sqrt(pseudo_votes) para o blend IA(n) vs Nota.M */
  pseudoVotesBlend: number
}

/**
 * Nota.IA — score determinístico principal.
 *
 * 1. Blend entre IA(n) e Nota.M usando sqrt dos votos como peso
 * 2. Multiplica por fator de sinopse (♥..♥♥♥♥)
 * 3. Soma Obs adjustment em pontos de nota, clamp ∈ [-0.30, +0.30]
 *    (positivo = bônus, negativo = penalidade)
 * 4. Clamp 0–10
 *
 * Status (`publication_status`) e capítulos (`Cps.N`) NÃO entram aqui — são
 * features do Ridge (Nota.Pr), que aprende seus pesos contra `user_score`.
 * Aplicá-los também aqui criaria intervenção duplicada (multiplicador fixo
 * em Nota.Calc + peso aprendido no Ridge) que enfraquece a calibração.
 */
export function calculateNotaCalc(inputs: NotaCalcInputs): number {
  const {
    iaEvalNormalized,
    platformAvg,
    totalVotes,
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

  const synopsisMult = synopsisQuality
    ? (SYNOPSIS_MULTIPLIER[synopsisQuality] ?? 1)
    : 1
  const obsAdjustment = Math.min(Math.max(observationAdjustment, -0.30), 0.30)

  const result = blend * synopsisMult + obsAdjustment

  return Math.max(0, Math.min(10, result))
}
