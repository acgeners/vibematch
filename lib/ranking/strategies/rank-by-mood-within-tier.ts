import type { RankingCandidate, RankedStrategyItem } from "./types"

/**
 * Estratégia experimental `mood_within_tier`:
 *  1. PRESERVA os tiers exibidos (não move obra entre tiers);
 *  2. reordena SOMENTE dentro de cada tier pelo moodAdjustedScore (desc);
 *  3. usa o ajuste de mood JÁ calculado (não recalcula nada);
 *  4. NÃO altera o ranking exibido.
 *
 * Inelegibilidade (não vira zero):
 *  - obra sem displayedTier (sem score válido pra formar banda);
 *  - obra sem moodAdjustedScore (não há mood pra ela).
 *
 * Empate dentro do tier → workId crescente (determinístico). A rank_position é
 * GLOBAL (1-based) percorrendo os tiers em ordem e, dentro de cada tier, na nova
 * ordem por mood. Obras inelegíveis ficam fora da numeração (rank null).
 *
 * Atenção: quando NÃO há mood ativo, esta estratégia NÃO deve ser gerada (ver
 * buildShadowRankings) — não inventamos mood padrão. Pura e determinística.
 */
export function rankByMoodWithinTier(candidates: readonly RankingCandidate[]): RankedStrategyItem[] {
  const eligible: RankingCandidate[] = []
  const items: RankedStrategyItem[] = []

  for (const c of candidates) {
    const tierOk = c.displayedTier != null && Number.isFinite(c.displayedTier)
    const moodOk = c.moodAdjustedScore != null && Number.isFinite(c.moodAdjustedScore)
    if (tierOk && moodOk) {
      eligible.push(c)
    } else {
      items.push({
        predictionSnapshotId: c.predictionSnapshotId,
        workId: c.workId,
        rankPosition: null,
        tier: c.displayedTier ?? null,
        strategyScore: null,
        eligible: false,
        exclusionReason: tierOk ? "sem mood ajustado" : "sem tier exibido",
      })
    }
  }

  // Agrupa por tier; tiers em ordem crescente (1 = topo). Dentro do tier, ordena
  // por mood desc (empate → workId asc). NUNCA cruza a fronteira do tier.
  const byTier = new Map<number, RankingCandidate[]>()
  for (const c of eligible) {
    const t = c.displayedTier as number
    const arr = byTier.get(t) ?? []
    arr.push(c)
    byTier.set(t, arr)
  }
  const tiersAsc = [...byTier.keys()].sort((a, b) => a - b)

  let position = 0
  for (const t of tiersAsc) {
    const group = byTier.get(t) as RankingCandidate[]
    group.sort(
      (a, b) =>
        (b.moodAdjustedScore as number) - (a.moodAdjustedScore as number) ||
        (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0),
    )
    for (const c of group) {
      position += 1
      items.push({
        predictionSnapshotId: c.predictionSnapshotId,
        workId: c.workId,
        rankPosition: position,
        tier: t,
        strategyScore: c.moodAdjustedScore as number,
        eligible: true,
        exclusionReason: null,
      })
    }
  }

  return items
}
