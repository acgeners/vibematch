import { rankByNumericScore } from "./rank-helpers"
import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia `personal_fit`: ordena só pela afinidade permanente (0–1). Baseline
 * de compatibilidade — NÃO é candidata automática a substituir o ranking, e a
 * fórmula do personal_fit NÃO é alterada aqui. Obras sem personal_fit ficam
 * inelegíveis. Pura e determinística.
 */
export function rankByPersonalFit(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return rankByNumericScore(candidates, (c) => c.personalFit, "sem personal_fit")
}
