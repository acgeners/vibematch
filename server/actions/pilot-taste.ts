"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { TASTE_SCORE_KEYS, computeTasteUserScore } from "@/server/queries/pilot-taste"
import type { TasteScoreKey } from "@/server/queries/pilot-taste"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { canRateReadingState } from "@/lib/reading-gate"
import { markRecalcPending } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { capturePredictionForFirstRating } from "./prediction-ledger"
import { resolvePredictionsForWork } from "@/lib/server/predictions/resolve-prediction"

const ALLOWED = new Set<number>([2, 4, 6.5, 8, 10])

/**
 * Salva (upsert) as notas de gosto de UMA obra para QUEM ESTÁ LOGADO. O cliente manda o
 * estado completo da obra a cada mudança (autosave idempotente).
 *
 * Per-user desde a migration 169: `pilot_taste_scores` tem PK (user_id, work_id) e RLS
 * `user_id = auth.uid()`. A escrita vai pelo cliente de SESSÃO (`createUserClient`) de
 * propósito — se o código passar o id de outra pessoa, o Postgres NEGA em vez de virar
 * dado errado em silêncio (a lição do PR #127). O gate é o mesmo do resto do estado
 * pessoal (`ensureReadingStateWriter`): sessão + permissão `own_state`.
 */
export async function savePilotTaste(
  workId: string,
  scores: Partial<Record<TasteScoreKey, number | null>>,
  endingNa: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }

  if (!workId) return { ok: false, error: "workId ausente" }

  const row: Record<string, unknown> = {
    user_id: gate.userId,
    work_id: workId,
    ending_na: endingNa,
    updated_at: new Date().toISOString(),
  }
  for (const k of TASTE_SCORE_KEYS) {
    const v = scores[k]
    if (v != null && !ALLOWED.has(v)) {
      return { ok: false, error: `valor inválido em ${k}: ${v}` }
    }
    row[k] = v ?? null
  }

  const sb = await createUserClient()
  const { error } = await sb
    .from("pilot_taste_scores")
    .upsert(row, { onConflict: "user_id,work_id" })
  if (error) return { ok: false, error: error.message }

  // A nota de gosto passou a SER a nota pessoal (`user_score`) — o rótulo que treina o
  // Ridge, a Chance e o ledger de previsão DESTE usuário. Deriva-a dos 7 eixos fixos
  // (sem o Final) e persiste no estado pessoal dele.
  await applyTasteDerivedUserScore(gate.userId, gate.isOwner, workId, scores)

  return { ok: true }
}

/**
 * Grava o `user_score` derivado do gosto no estado pessoal de QUEM AVALIOU e roda o mesmo
 * pós-processamento que `updateWorkStatus` faz quando a nota muda: ledger prospectivo +
 * recalc pendente.
 *
 * - Só grava quando os 7 eixos fixos estão completos (`computeTasteUserScore` → null caso falte).
 * - Só grava quando o estado de leitura DESSE usuário passa no gate (`canRateReadingState`).
 * - No-op quando o rótulo não mudou (evita churn de ledger/recalc no autosave por estrela).
 * - `writeReadingState` (cliente de sessão): estamos DENTRO de uma request com sessão, então a
 *   RLS vale e protege — diferente dos caminhos de background, que precisam de `mirrorOwnerState`.
 * - O ledger é best-effort (telemetria) e captura a previsão PRÉ-rótulo: o recalc é DEFERIDO,
 *   então `calculated_scores` ainda é pré-rótulo na hora do capture. `capturePrediction…` e
 *   `resolvePredictions…` já resolvem o usuário DA SESSÃO internamente.
 * - Recalc: dono → fila global (`markRecalcPending`); demais → `recalculateForUser` em
 *   `after()` (mesmo desenho do `clearUserRating`).
 */
async function applyTasteDerivedUserScore(
  userId: string,
  isOwner: boolean,
  workId: string,
  scores: Partial<Record<TasteScoreKey, number | null>>,
): Promise<void> {
  const label = computeTasteUserScore(scores)
  if (label == null) return // faltam eixos — não gravamos média parcial (ver computeTasteUserScore)

  const supabase = createAdminClient()

  const { data: prevRow } = await supabase
    .from("user_work_state")
    .select("user_score, personal_status_id, chapters_read")
    .eq("user_id", userId)
    .eq("work_id", workId)
    .maybeSingle()
  const prevUserScore = (prevRow?.user_score as number | null | undefined) ?? null

  // "Só avalia quem leu" (lib/reading-gate.ts). O `/pilot-taste` lista obras que JÁ têm nota, e
  // a UI da página da obra esconde o card de gosto sem leitura suficiente — mas nenhuma das duas
  // é regra: esta action é endpoint público, e é por aqui que a nota de gosto vira `user_score`.
  // O estado de leitura consultado é O DO PRÓPRIO usuário (user_work_state dele).
  const { data: workRow } = await supabase
    .from("works")
    .select("total_chapters")
    .eq("id", workId)
    .maybeSingle()
  const canRate = canRateReadingState({
    personalStatus: (prevRow?.personal_status_id as number | null | undefined) ?? null,
    chaptersRead: (prevRow?.chapters_read as number | null | undefined) ?? null,
    totalChapters: (workRow?.total_chapters as number | null | undefined) ?? null,
  })
  if (!canRate) return

  if (prevUserScore != null && Number(prevUserScore) === label) return // nada mudou

  const write = await writeReadingState(userId, [workId], { user_score: label })
  if (write.error) {
    console.error("[savePilotTaste] falha gravando user_score:", write.error)
    return
  }

  // Validação prospectiva: primeira nota (null → valor) congela a previsão de-registro antes do
  // recalc deferido incluir o rótulo. Edição resolve/relabel. Idênticos aos ramos de updateWorkStatus.
  if (prevUserScore == null) {
    await capturePredictionForFirstRating(workId, label)
  }
  await resolvePredictionsForWork(workId, label)

  if (isOwner) {
    await markRecalcPending("savePilotTaste")
  } else {
    after(async () => {
      try {
        await recalculateForUser(userId)
      } catch (err) {
        console.error("[savePilotTaste] recalc do usuário falhou:", err)
      }
    })
  }
  revalidatePath(`/titles/${workId}`)
}
