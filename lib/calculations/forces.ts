/**
 * As 3 forças da Bússola de Leitura (0–100) — ver PLANO-BUSSOLA-3-FORCAS.md.
 *
 *   Chance de gostar  → chance_score (já 0–100, logística calibrada)
 *   Avaliação         → platform_avg (0–10) reescalado ×10
 *   Alcance           → votos, log-normalizados contra uma referência de
 *                       "muito popular" (assimetria forte: mediana ~500 votos,
 *                       cauda até ~190k, então escala log)
 *
 * Puro/sem I/O — usado no server (queries) e no client (chips/meters). Não
 * persiste nada novo: reusa chance_score/platform_avg/total_votes já no banco.
 */

/**
 * Referência de votos que satura o Alcance em ~100. 50k ≈ p99+ do acervo
 * (medido 2026-07-06). Ajustar aqui se o catálogo crescer muito.
 */
export const POPULARITY_REFERENCE_VOTES = 50000

export interface WorkForces {
  /** Chance de você gostar (0–100). null quando sem modelo (stub/arquivada). */
  chance: number | null
  /** Avaliação da crítica (0–100). null quando sem notas externas. */
  avaliacao: number | null
  /** Alcance / popularidade (0–100). null quando 0 votos. */
  alcance: number | null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Arquétipo de decisão (cor/quadrante da Bússola), derivado do cruzamento
 * Chance × Avaliação — o par que define "que tipo de aposta é essa pra você".
 * Estável entre as faces do plano (a cor viaja com a obra).
 *
 *   safe   = provável gostar + bem avaliada   → aposta segura
 *   niche  = provável gostar + mal avaliada   → teu nicho (você curte, crítica não)
 *   upside = improvável gostar + bem avaliada → alto potencial (aclamada, arriscada)
 *   skip   = improvável gostar + mal avaliada → pular
 */
export type ForceArchetype = "safe" | "niche" | "upside" | "skip"

/** Limiares dos eixos pra classificar o arquétipo (0–100). */
export const CHANCE_LIKELY_THRESHOLD = 50
export const AVALIACAO_RATED_THRESHOLD = 65

export function classifyArchetype(chance: number | null, avaliacao: number | null): ForceArchetype {
  const likely = (chance ?? 0) >= CHANCE_LIKELY_THRESHOLD
  const rated = (avaliacao ?? 0) >= AVALIACAO_RATED_THRESHOLD
  if (likely && rated) return "safe"
  if (likely && !rated) return "niche"
  if (!likely && rated) return "upside"
  return "skip"
}

/**
 * Variante por PERCENTIL (median-split em 50) — usada na Bússola 2D, onde a
 * posição é relativa ao acervo. Alinha os quadrantes visuais (linha do meio =
 * mediana) com a cor do arquétipo. Ver [[project_bussola_3forcas]].
 */
export function classifyArchetypeByPercentile(chancePct: number, avaliacaoPct: number): ForceArchetype {
  const likely = chancePct >= 50
  const rated = avaliacaoPct >= 50
  if (likely && rated) return "safe"
  if (likely && !rated) return "niche"
  if (!likely && rated) return "upside"
  return "skip"
}

export function computeWorkForces(input: {
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number | null
}): WorkForces {
  const chance =
    input.chanceScore != null && Number.isFinite(input.chanceScore)
      ? Math.round(clamp(input.chanceScore, 0, 100))
      : null

  const avaliacao =
    input.platformAvg != null && Number.isFinite(input.platformAvg)
      ? Math.round(clamp(input.platformAvg * 10, 0, 100))
      : null

  const votes = input.totalVotes ?? 0
  const alcance =
    votes > 0
      ? Math.round(clamp((Math.log1p(votes) / Math.log1p(POPULARITY_REFERENCE_VOTES)) * 100, 0, 100))
      : null

  return { chance, avaliacao, alcance }
}
