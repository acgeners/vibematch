/**
 * Helpers PUROS compartilhados pelas estratégias de ranking (shadow mode).
 *
 * Regra única de tratamento de null/ausência: valores válidos primeiro (desc),
 * empate determinístico por workId (asc); valores ausentes/inválidos NÃO viram
 * zero — a obra fica INELEGÍVEL com motivo. Determinístico e sem mutar a entrada.
 */

import type { RankingCandidate, RankedStrategyItem } from "./types"

function isValidScore(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/** Empate estável e determinístico: workId crescente (independe da ordem de entrada). */
function compareWorkId(a: RankingCandidate, b: RankingCandidate): number {
  return a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0
}

/**
 * Ordena os candidatos por um score numérico (desc). Obras com score válido
 * recebem rank_position 1-based e strategy_score; as demais ficam inelegíveis
 * com `missingReason`. NÃO muta a lista recebida. `tier` fica null (ordenação
 * plana — só displayed_current/mood_within_tier preservam tiers).
 */
export function rankByNumericScore(
  candidates: readonly RankingCandidate[],
  getScore: (c: RankingCandidate) => number | null,
  missingReason: string,
): RankedStrategyItem[] {
  const valid: Array<{ c: RankingCandidate; score: number }> = []
  const invalid: RankingCandidate[] = []

  for (const c of candidates) {
    const score = getScore(c)
    if (isValidScore(score)) valid.push({ c, score })
    else invalid.push(c)
  }

  valid.sort((a, b) => b.score - a.score || compareWorkId(a.c, b.c))

  const items: RankedStrategyItem[] = valid.map((e, i) => ({
    predictionSnapshotId: e.c.predictionSnapshotId,
    workId: e.c.workId,
    rankPosition: i + 1,
    tier: null,
    strategyScore: e.score,
    eligible: true,
    exclusionReason: null,
  }))

  for (const c of invalid) {
    items.push({
      predictionSnapshotId: c.predictionSnapshotId,
      workId: c.workId,
      rankPosition: null,
      tier: null,
      strategyScore: null,
      eligible: false,
      exclusionReason: missingReason,
    })
  }

  return items
}
