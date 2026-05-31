"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { getCurrentUserId } from "@/server/queries/current-user"
import { getLatestAiEvaluationAttributes } from "@/server/queries/post-attribute-assessment"
import { recomputeAttributeBias } from "@/lib/calculations/attribute-bias"
import { recalculateAllInBackground } from "@/server/actions/calculations"

export type PostReadingResult = { ok: true } | { ok: false; error: string }

/**
 * Salva a reavaliação pós-leitura dos 9 atributos pela ótica do usuário.
 *
 * `values` traz só o valor do usuário por atributo (0–10). O snapshot da
 * IA (valor + modelo + prompt) vem da última avaliação completed — fonte
 * de verdade pro delta — e `source` é derivada server-side comparando os
 * dois (não confiamos no client).
 *
 * Fluxo: snapshot IA → UPSERT 9 rows → recomputa offset → recalcula obra.
 */
export async function submitPostReadingAttributes(
  workId: string,
  values: Partial<Record<CriterionSlug, number>>,
): Promise<PostReadingResult> {
  const supabase = createAdminClient()

  const latestAi = await getLatestAiEvaluationAttributes(workId, supabase)
  if (!latestAi) {
    return { ok: false, error: "Obra sem avaliação IA — rode a avaliação antes de calibrar." }
  }

  const userId = await getCurrentUserId(supabase)
  const now = new Date().toISOString()

  const rows: Array<Record<string, unknown>> = []
  for (const slug of CRITERION_SLUGS) {
    const userValue = values[slug as CriterionSlug]
    const iaValue = latestAi.attributes[slug as CriterionSlug]
    // Sem nota da IA pra esse atributo não há delta — pula.
    if (userValue == null || iaValue == null) continue
    if (!Number.isFinite(userValue) || userValue < 0 || userValue > 10) {
      return { ok: false, error: `Valor inválido para ${slug}: ${userValue}` }
    }

    // Source derivada da comparação: igual à IA = aceite, diferente = edição.
    const source = userValue === iaValue ? "ai_accepted_post_read" : "user_edited_post_read"

    rows.push({
      user_id: userId,
      work_id: workId,
      attribute_slug: slug,
      user_value: userValue,
      source,
      ia_value_at_assessment: iaValue,
      ia_model_at_assessment: latestAi.modelName,
      ia_prompt_version: latestAi.promptVersion,
      ia_evaluation_id: latestAi.evaluationId,
      updated_at: now,
    })
  }

  if (rows.length === 0) {
    return { ok: false, error: "Nenhum atributo com nota da IA pra comparar." }
  }

  const { error: upsertError } = await supabase
    .from("user_attribute_assessment")
    .upsert(rows, { onConflict: "user_id,work_id,attribute_slug" })

  if (upsertError) {
    return { ok: false, error: `Falha salvando avaliação: ${upsertError.message}` }
  }

  await recomputeAttributeBias(userId, supabase)
  // Recalc roda em background (coalescido): o save retorna na hora; os scores
  // atualizam quando o recalc termina (igual ao updateWorkStatus). Antes isso
  // era um `await recalculateAll()` bloqueante de dezenas de segundos.
  await recalculateAllInBackground("submitPostReadingAttributes")
  revalidatePath(`/titles/${workId}`)

  return { ok: true }
}
