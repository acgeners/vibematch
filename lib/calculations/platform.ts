import type { PlatformRating } from "@/types/domain"

/**
 * Nota.M — Bayesian weighted average das plataformas externas.
 *
 * Fórmula (da planilha):
 *   nota_m = (votes / (votes + pseudo)) * weighted_avg
 *           + (pseudo / (votes + pseudo)) * global_mean
 *
 * Onde weighted_avg = soma(rating * votes) / soma(votes)
 * e global_mean é a média geral de todas as obras (calculada externamente
 * ou passada como parâmetro; valor típico ≈ 8.0–8.2).
 */
export function calculatePlatformAvg(
  ratings: PlatformRating[],
  globalMean: number,
  pseudoVotes: number
): number | null {
  const validRatings = ratings.filter(
    (r) => r.rating != null && r.vote_count > 0
  )

  if (validRatings.length === 0) return null

  const totalVotes = validRatings.reduce((acc, r) => acc + r.vote_count, 0)

  if (totalVotes === 0) return null

  const weightedSum = validRatings.reduce(
    (acc, r) => acc + (r.rating ?? 0) * r.vote_count,
    0
  )

  const localAvg = weightedSum / totalVotes
  const weight = totalVotes / (totalVotes + pseudoVotes)

  return weight * localAvg + (1 - weight) * globalMean
}

/**
 * Total de votos somando todas as plataformas.
 */
export function sumVotes(ratings: PlatformRating[]): number {
  return ratings.reduce((acc, r) => acc + (r.vote_count ?? 0), 0)
}

/**
 * Calcula a média global de Nota.M de toda a base para usar no Bayesian avg.
 * Recebe a lista de todas as notas calculadas.
 */
export function computeGlobalPlatformMean(allNotaM: number[]): number {
  if (allNotaM.length === 0) return 8.0
  const sum = allNotaM.reduce((a, b) => a + b, 0)
  return sum / allNotaM.length
}
