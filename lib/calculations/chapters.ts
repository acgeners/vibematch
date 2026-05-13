/**
 * Cps.N = MIN(LOG(chapters + 1) / LOG(200), 1) * 10
 *
 * Normaliza o número de capítulos em escala 0–10.
 * 200 capítulos → Cps.N ≈ 10 (satura).
 */
export function normalizeChapters(chapters: number | null): number {
  if (!chapters || chapters <= 0) return 0
  return Math.min(Math.log(chapters + 1) / Math.log(200), 1) * 10
}
