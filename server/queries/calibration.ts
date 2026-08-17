import { createAdminClient } from "@/lib/supabase/admin"
import type { CriterionSlug } from "@/types/domain"

/**
 * Único resto vivo da auditoria de critérios, aposentada em 2026-08-16.
 *
 * As 40 notas com `source = 'ai_calibrated'` que ela deixou continuam valendo, e sem isto a
 * página da obra voltaria a exibir a justificativa da AVALIAÇÃO ao lado delas — que fala de
 * outro número em 27 das 37 medidas na época. A prosa certa é a da sugestão que moveu a nota,
 * recuperada por chave natural (obra + critério, aplicação mais recente).
 */
type StatusAplicado = "auto_applied" | "accepted" | "edited"

/**
 * Procedência de um score que a auditoria reescreveu, por critério.
 *
 * 🔴 Existe porque a nota e a prosa que a explicam moram em tabelas diferentes: o número
 * está em `category_scores`, e a página imprime a justificativa da avaliação VIGENTE
 * (`ai_evaluation_scores`). Quando a auditoria muda a nota, ela não toca na avaliação —
 * então a prosa segue defendendo o número antigo. Medido em 2026-08-16: das 37 notas com
 * `source = 'ai_calibrated'`, **28 exibiam uma justificativa que contradiz a própria nota**,
 * a 1,79 ponto de distância em média, sob o selo de uma avaliação que não as produziu.
 *
 * A sugestão que moveu a nota já traz a justificativa certa — ela só era descartada depois
 * de aplicada. Aqui ela é recuperada por chave natural (obra + critério, a aplicação mais
 * recente), em vez de copiada para outra tabela: a linha da sugestão continua sendo a dona
 * do próprio texto, e não há duas cópias para divergir.
 */
export interface CalibrationProvenance {
  justification: string
  previousScore: number
  appliedScore: number
  appliedAt: string | null
  status: StatusAplicado
}

export async function getCalibrationProvenanceForWork(
  workId: string,
): Promise<Map<CriterionSlug, CalibrationProvenance>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("score_calibration_suggestions")
    .select("criterion_slug, justification, previous_score, applied_score, applied_at, status")
    .eq("work_id", workId)
    .in("status", ["auto_applied", "accepted", "edited"])
    .order("applied_at", { ascending: false, nullsFirst: false })
  if (error) {
    // Falha aqui não pode derrubar a página da obra: sem o mapa, o card degrada para o
    // comportamento antigo (prosa da avaliação) em vez de não renderizar.
    console.error("[calibration] erro lendo procedência de calibração:", error.message)
    return new Map()
  }

  const out = new Map<CriterionSlug, CalibrationProvenance>()
  for (const row of data ?? []) {
    const slug = row.criterion_slug as CriterionSlug
    // `order` já veio da mais recente pra mais antiga: a primeira de cada critério é a
    // aplicação que está em vigor.
    if (out.has(slug)) continue
    const applied = row.applied_score == null ? null : Number(row.applied_score)
    if (applied == null || !row.justification) continue
    out.set(slug, {
      justification: row.justification as string,
      previousScore: Number(row.previous_score),
      appliedScore: applied,
      appliedAt: (row.applied_at as string | null) ?? null,
      status: row.status as StatusAplicado,
    })
  }
  return out
}

