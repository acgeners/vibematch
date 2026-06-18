import { rankByNumericScore } from "./rank-helpers"
import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia `expected_score`: ordena só pela satisfação prevista (Nota Prevista,
 * Ridge⊕calc). Usa o predicted_score JÁ registrado no snapshot — não recalcula.
 * Obras sem previsão ficam inelegíveis. Pura e determinística.
 */
export function rankByExpectedScore(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return rankByNumericScore(candidates, (c) => c.predictedScore, "sem predicted_score")
}
