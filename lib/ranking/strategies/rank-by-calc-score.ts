import { rankByNumericScore } from "./rank-helpers"
import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia `calc_score`: ordena só pela Nota.Calc (desc). Obras sem calc_score
 * ficam inelegíveis (não viram zero). Pura e determinística.
 */
export function rankByCalcScore(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return rankByNumericScore(candidates, (c) => c.calcScore, "sem calc_score")
}
