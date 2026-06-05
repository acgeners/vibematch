import type { WorkCover } from "@/types/domain"

/** Aceita tanto WorkCover completo quanto seleções parciais (ex.: dashboard). */
type CoverLike = Pick<WorkCover, "url" | "is_primary">

/**
 * Escolhe a URL da capa primária de uma obra: prioriza a marcada como
 * `is_primary`, senão cai na primeira disponível. Centraliza o padrão antes
 * duplicado em work-table, work-heatmap-view e no dashboard.
 */
export function pickPrimaryCover(covers: CoverLike[] | null | undefined): string | null {
  if (!covers || covers.length === 0) return null
  const primary = covers.find((c) => c.is_primary)
  return (primary ?? covers[0])?.url ?? null
}
