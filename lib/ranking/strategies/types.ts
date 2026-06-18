/**
 * Tipos do SHADOW RANKING (comparação prospectiva de estratégias / AUDIT_REPORT P1).
 *
 * Uma RankingCandidate é a obra prospectiva (sem user_score ainda) de UMA run,
 * com todos os sinais JÁ calculados naquela recomendação. As funções de
 * estratégia (rank-by-*) recebem a lista e devolvem RankedStrategyItem[] —
 * SEM consultar banco, SEM data atual, SEM config global, SEM mutar a entrada.
 */

import type { RankingStrategyKey } from "./registry"

export interface RankingCandidate {
  /** id do prediction_snapshot desta obra nesta run (identidade da obra na run). */
  predictionSnapshotId: string
  workId: string
  /** Posição 1-based na ordem REALMENTE exibida ao usuário (LLM ranker). */
  displayedRank: number
  /** Tier (banda) exibido no momento (1 = topo). null = sem score válido. */
  displayedTier: number | null
  /** Nota Prevista (expected_score) 0–10. */
  predictedScore: number | null
  /** Nota.Calc 0–10. */
  calcScore: number | null
  /** Afinidade permanente 0–1. */
  personalFit: number | null
  /** Veredito IA 0–100 (null se a obra não foi re-rankeada). */
  alignmentScore: number | null
  /** Prioridade (decision_score) 0–10. */
  decisionScore: number | null
  /** Prioridade ajustada ao mood (0–10). null quando não há mood ativo. */
  moodAdjustedScore: number | null
}

export interface RankedStrategyItem {
  predictionSnapshotId: string
  workId: string
  /** 1-based; null quando inelegível. */
  rankPosition: number | null
  /** Tier preservado (displayed_current / mood_within_tier); null nas ordenações planas. */
  tier: number | null
  /** Valor escalar de ordenação; null pra ordenações que só têm posição. */
  strategyScore: number | null
  eligible: boolean
  /** Obrigatório quando eligible=false; null quando elegível. */
  exclusionReason: string | null
}

export interface ShadowRankingResult {
  key: RankingStrategyKey
  version: string
  isDisplayedStrategy: boolean
  items: RankedStrategyItem[]
}
