/**
 * Orquestra TODAS as estratégias de ranking sobre o MESMO conjunto de candidatos
 * de uma run (shadow mode). Função PURA: sem I/O, sem data atual, sem config
 * global, sem mutar a entrada. AUDIT_REPORT P1.
 *
 * `displayed_current` reproduz a ordem realmente exibida (não reconstrói): usa o
 * displayedRank/displayedTier capturados no momento da entrega à interface.
 *
 * `mood_within_tier` SÓ é gerada quando `moodActive` — sem mood não inventamos
 * mood padrão (a estratégia simplesmente não existe naquele run).
 */

import { RANKING_STRATEGIES } from "./registry"
import { rankByCalcScore } from "./rank-by-calc-score"
import { rankByExpectedScore } from "./rank-by-expected-score"
import { rankByDecisionScore } from "./rank-by-decision-score"
import { rankByPersonalFit } from "./rank-by-personal-fit"
import { rankByAlignmentScore } from "./rank-by-alignment-score"
import { rankByMoodWithinTier } from "./rank-by-mood-within-tier"
import type { RankingCandidate, RankedStrategyItem, ShadowRankingResult } from "./types"

export interface BuildShadowRankingsArgs {
  candidates: readonly RankingCandidate[]
  /** Há mood ativo nesta run? Sem mood, mood_within_tier não é gerada. */
  moodActive: boolean
}

/** Reproduz a ordem exibida diretamente dos campos capturados (não reordena). */
function buildDisplayedCurrent(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  return candidates.map((c) => ({
    predictionSnapshotId: c.predictionSnapshotId,
    workId: c.workId,
    rankPosition: c.displayedRank,
    tier: c.displayedTier,
    // A ordem exibida vem do ranker LLM; não há escalar único — a posição É o sinal.
    strategyScore: null,
    eligible: true,
    exclusionReason: null,
  }))
}

export function buildShadowRankings(args: BuildShadowRankingsArgs): ShadowRankingResult[] {
  const { candidates, moodActive } = args

  const results: ShadowRankingResult[] = [
    {
      key: RANKING_STRATEGIES.displayed_current.key,
      version: RANKING_STRATEGIES.displayed_current.version,
      isDisplayedStrategy: true,
      items: buildDisplayedCurrent(candidates),
    },
    {
      key: RANKING_STRATEGIES.calc_score.key,
      version: RANKING_STRATEGIES.calc_score.version,
      isDisplayedStrategy: false,
      items: rankByCalcScore(candidates),
    },
    {
      key: RANKING_STRATEGIES.expected_score.key,
      version: RANKING_STRATEGIES.expected_score.version,
      isDisplayedStrategy: false,
      items: rankByExpectedScore(candidates),
    },
    {
      key: RANKING_STRATEGIES.decision_score.key,
      version: RANKING_STRATEGIES.decision_score.version,
      isDisplayedStrategy: false,
      items: rankByDecisionScore(candidates),
    },
    {
      key: RANKING_STRATEGIES.personal_fit.key,
      version: RANKING_STRATEGIES.personal_fit.version,
      isDisplayedStrategy: false,
      items: rankByPersonalFit(candidates),
    },
    {
      key: RANKING_STRATEGIES.alignment_score.key,
      version: RANKING_STRATEGIES.alignment_score.version,
      isDisplayedStrategy: false,
      items: rankByAlignmentScore(candidates),
    },
  ]

  if (moodActive) {
    results.push({
      key: RANKING_STRATEGIES.mood_within_tier.key,
      version: RANKING_STRATEGIES.mood_within_tier.version,
      isDisplayedStrategy: false,
      items: rankByMoodWithinTier(candidates),
    })
  }

  return results
}
