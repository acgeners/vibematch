import { rankByNumericScore } from "./rank-helpers"
import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia `decision_score`: ordena pela Prioridade existente. Quando ausente
 * (sem Nota Prevista → sem âncora), a obra fica INELEGÍVEL — não tratamos
 * ausência de alignment como alinhamento neutro nem preenchemos com zero. A
 * cobertura da estratégia (quantas obras têm decision) fica explícita nas
 * métricas. Pura e determinística.
 */
export function rankByDecisionScore(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return rankByNumericScore(candidates, (c) => c.decisionScore, "sem decision_score")
}
