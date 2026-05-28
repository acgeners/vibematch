/**
 * Percentil de uma posição dentro de um pool ordenado.
 * rank=1 (topo) num pool de 100 → 100. rank=100 (último) → 1.
 * Útil pra mostrar "Top X%" relativo ao que o usuário está vendo.
 */
export function computeRankPercentile(rank: number, total: number): number {
  if (total <= 0 || rank <= 0) return 0
  if (rank > total) return 0
  return ((total - rank + 1) / total) * 100
}

/**
 * Formata percentil pra exibição compacta: "Top 1%", "Top 50%", "Top 100%".
 * Entrada vem de computeRankPercentile (100 = topo, próximo de 0 = base).
 */
export function formatPercentile(percentile: number | null | undefined): string {
  if (percentile == null) return "—"
  const inverted = Math.min(100, Math.max(1, Math.round(100 - percentile + 1)))
  return `Top ${inverted}%`
}
