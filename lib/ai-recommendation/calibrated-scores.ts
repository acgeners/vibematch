import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug, ScoreSource } from "@/types/domain"

// ============================================================
// Aplicação on-read do offset de atributos (Fase 1.5)
// ============================================================
// Toda leitura de category_scores destinada ao pipeline de predição /
// recomendação passa por aqui. NÃO materializamos o valor calibrado no
// DB: calcular on-read permite ligar/desligar a correção sem migration,
// reflete sempre o offset atual (sem cache stale) e preserva o histórico
// bruto pra auditoria.

export type AttributeBiasMap = Record<string, number>

export interface CategoryScoreWithSource {
  value: number
  source: ScoreSource
}

// Só corrigimos valores que de fato vieram da IA. `manual` e `ai_edited`
// são âncoras do usuário (espelha LOCKED_SOURCES em server/actions/calibration.ts,
// que não é importável daqui por ser um arquivo "use server"). `imported`
// também fica de fora: não é estimativa da IA, então subtrair o viés da IA
// não faz sentido conceitual.
export const BIAS_APPLICABLE_SOURCES: ReadonlySet<ScoreSource> = new Set<ScoreSource>([
  "ai_accepted",
  "ai_calibrated",
])

/**
 * Aplica `valor_calibrado = valor_IA - bias_applied` aos atributos cuja
 * origem é a IA. Demais origens passam intactas. Slugs ausentes viram null.
 */
export function applyBiasToCategoryScores(
  rawScores: Partial<Record<CriterionSlug, CategoryScoreWithSource>>,
  biasMap: AttributeBiasMap,
): Record<CriterionSlug, number | null> {
  const result = {} as Record<CriterionSlug, number | null>
  for (const slug of CRITERION_SLUGS) {
    const entry = rawScores[slug as CriterionSlug]
    if (entry == null) {
      result[slug as CriterionSlug] = null
      continue
    }
    if (!BIAS_APPLICABLE_SOURCES.has(entry.source)) {
      result[slug as CriterionSlug] = entry.value
      continue
    }
    result[slug as CriterionSlug] = entry.value - (biasMap[slug] ?? 0)
  }
  return result
}
