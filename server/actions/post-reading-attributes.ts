"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { ensureSignedIn } from "@/server/queries/current-user"
import { getLatestAiEvaluationAttributes } from "@/server/queries/post-attribute-assessment"
import { recomputeAttributeBias } from "@/lib/calculations/attribute-bias"
import { markRecalcPending } from "@/server/recalc/queue"

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
  // DOIS clientes, de propósito:
  //   `supabase` (service role) → CATÁLOGO. A avaliação da IA é fato da obra, não dado seu, e
  //      não tem política de RLS: lê-la com o cliente do usuário devolveria ZERO linhas — e a
  //      action responderia "obra sem avaliação IA", que é mentira.
  //   `userDb` (sessão)         → SEUS dados. A RLS (mig 142) prende as linhas ao seu user_id.
  const supabase = createAdminClient()

  const latestAi = await getLatestAiEvaluationAttributes(workId, supabase)
  if (!latestAi) {
    return { ok: false, error: "Obra sem avaliação IA — rode a avaliação antes de calibrar." }
  }

  const auth = await ensureSignedIn()
  if (!auth.ok) return { ok: false, error: auth.error }
  const userId = auth.userId
  const userDb = await createUserClient()
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

  const { error: upsertError } = await userDb
    .from("user_attribute_assessment")
    .upsert(rows, { onConflict: "user_id,work_id,attribute_slug" })

  if (upsertError) {
    return { ok: false, error: `Falha salvando avaliação: ${upsertError.message}` }
  }

  // Lê user_attribute_assessment e grava attribute_bias — as duas são suas.
  await recomputeAttributeBias(userId, userDb)
  // A pós-leitura entra no recalc global por UM caminho só: o `attribute_bias`,
  // que desloca on-read as notas de origem IA. (As 8 colunas `post_*_score` NÃO
  // são features — `QUALITY_NUMERIC_FEATURES` é vazio.) Marca pendente em vez de
  // recalcular na hora; a Nota Prevista atualiza no "Recalcular agora" ou no
  // auto-recalc (≥1h sem novas edições).
  //
  // `actorId`: o recalc global lê o viés DO DONO. Sem isto, a calibração de um
  // leitor acendia o badge do curador e o recálculo devolvia os mesmos números.
  await markRecalcPending("submitPostReadingAttributes", {
    changed: ["attribute_bias"],
    actorId: userId,
  })
  revalidatePath(`/titles/${workId}`)

  return { ok: true }
}
