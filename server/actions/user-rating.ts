"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createUserClient } from "@/lib/supabase/user"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { discardPredictionsForWork } from "@/lib/server/predictions/resolve-prediction"
import { markRecalcPending } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"

/** As 8 notas craft pós-leitura — as que a média ponderada do form transforma em `user_score`. */
const CRAFT_SCORE_COLUMNS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

/**
 * Apaga a SUA avaliação de uma obra: a nota pessoal (`user_score`) e as duas avaliações que a
 * geram — os 8 critérios craft e os 8 eixos de gosto.
 *
 * Por que existe: não havia NENHUM caminho pra remover a própria nota. O campo "Minha nota" é
 * `readOnly` (ela é derivada), e os dois formulários guardam explicitamente o valor anterior
 * quando as notas de origem são zeradas — `if (calculatedScore == null && initialValues.user_score
 * != null) return` no `work-form` e o fallback `: initialValues.user_score` no `work-status-form`.
 * Zerar as estrelas e salvar devolvia a mesma nota. Nas de gosto nem desmarcar dava.
 *
 * ⚠️ ISENTO do gate de leitura (`canRateReadingState`), de propósito: **apagar não é avaliar**.
 * Sob o gate, as obras cuja leitura não sustenta a nota — justamente as inconsistentes — seriam
 * as únicas impossíveis de limpar.
 *
 * ⚠️ NÃO mexe em `user_attribute_assessment` (a sua releitura dos 9 atributos da IA). Aquilo
 * alimenta o `attribute_bias`, não a nota — apagar junto tiraria calibração que não foi pedida.
 *
 * O que a remoção alcança, ponta a ponta:
 * - **treino do Ridge**: automático — `recalculateAll` treina com `works.filter(w => w.userScore
 *   != null)`, então a obra some do treino, dos `ratedTagCounts` e do cvMAE. DEFERIDO: roda no
 *   "Recalcular agora" ou após 1h ociosa, não no clique.
 * - **medição prospectiva**: `discardPredictionsForWork` (mig 168). Antes disto só se carimbava
 *   `label_changed_at`, coluna que NENHUMA métrica filtra — a previsão seguia sendo pontuada
 *   contra um gabarito retirado.
 * - **perfil de gosto**: se marca defasado sozinho (o `input_hash` muda), mas o payload salvo
 *   segue citando a obra até ser regenerado — regenerar chama a IA e custa, então não é aqui.
 */
export async function clearUserRating(
  workId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "workId ausente" }

  // Nota + craft: espelho de QUEM ESTÁ ESCREVENDO, pelo cliente de sessão (RLS filtra por
  // `user_id = auth.uid()`). Aqui as colunas vão explicitamente a `null` — é o oposto do patch
  // de `updateWorkStatus`, que OMITE o bloco pra preservar o gravado.
  const cleared = Object.fromEntries(CRAFT_SCORE_COLUMNS.map((c) => [c, null]))
  const write = await writeReadingState(gate.userId, [workId], {
    user_score: null,
    quick_score: null, // a nota rápida (mig 171) é avaliação — cai junto
    ...cleared,
  })
  if (write.error) return { ok: false, error: write.error }

  // Eixos de gosto: per-user desde a mig 169 (PK user_id+work_id, RLS `user_id = auth.uid()`).
  // Apaga a PRÓPRIA linha pelo cliente de sessão — a RLS garante que a de outra pessoa fica
  // intocada mesmo se o filtro estiver errado.
  {
    const userDb = await createUserClient()
    const { error } = await userDb
      .from("pilot_taste_scores")
      .delete()
      .eq("user_id", gate.userId)
      .eq("work_id", workId)
    if (error) return { ok: false, error: `Falha limpando as notas de gosto: ${error.message}` }
  }

  // DESCARTA a medição prospectiva desta obra — não é o mesmo que `markPredictionLabelChanged`
  // (que `updateWorkStatus` usa e que só carimba auditoria, sem tirar nada das métricas).
  // Aqui o rótulo foi APAGADO: não existe gabarito, então acerto/erro medidos contra ele são
  // lixo. As linhas continuam no banco pra auditoria; as métricas as filtram (mig 168).
  await discardPredictionsForWork(workId)

  // O modelo perdeu um rótulo: a Nota Prevista precisa ser refeita sem ele.
  if (gate.isOwner) {
    await markRecalcPending("clearUserRating")
  } else {
    after(async () => {
      try {
        await recalculateForUser(gate.userId)
      } catch (err) {
        console.error("[clearUserRating] recalc do usuário falhou:", err)
      }
    })
  }

  revalidatePath("/catalog/[id]", "page")
  revalidatePath("/catalog")
  revalidatePath("/ranking")
  revalidatePath("/reading")
  revalidatePath("/")

  return { ok: true }
}
