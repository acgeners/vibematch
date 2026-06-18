import { rankByNumericScore } from "./rank-helpers"
import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia `alignment_score`: ordena só pelo Veredito IA (0–100). Como o campo
 * não existe pra todas as obras (só as re-rankeadas), obras sem alignment ficam
 * INELEGÍVEIS e a cobertura é registrada. Comparações com outras estratégias
 * devem usar o subconjunto comum (não comparar coberturas diferentes como se
 * fossem equivalentes). Pura e determinística.
 */
export function rankByAlignmentScore(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return rankByNumericScore(candidates, (c) => c.alignmentScore, "sem alignment_score")
}
