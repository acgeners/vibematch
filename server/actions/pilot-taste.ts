"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, getOwnerUserId } from "@/server/queries/current-user"
import { TASTE_SCORE_KEYS, computeTasteUserScore } from "@/server/queries/pilot-taste"
import type { TasteScoreKey } from "@/server/queries/pilot-taste"
import { mirrorOwnerState } from "@/server/queries/user-work-state"
import { canRateReadingState } from "@/lib/reading-gate"
import { markRecalcPending } from "@/server/recalc/queue"
import { capturePredictionForFirstRating } from "./prediction-ledger"
import { resolvePredictionsForWork } from "@/lib/server/predictions/resolve-prediction"

const ALLOWED = new Set<number>([2, 4, 6.5, 8, 10])

/**
 * Salva (upsert) as notas de gosto de UMA obra no piloto. O cliente manda o
 * estado completo da obra a cada mudança (autosave idempotente).
 */
export async function savePilotTaste(
  workId: string,
  scores: Partial<Record<TasteScoreKey, number | null>>,
  endingNa: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `pilot_taste_scores` NÃO tem user_id: a tabela é GLOBAL. Enquanto for, escrever nela
  // é escrever no experimento do dono — logo, é curadoria, não dado pessoal.
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }

  if (!workId) return { ok: false, error: "workId ausente" }

  const row: Record<string, unknown> = {
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

  const sb = createAdminClient()
  const { error } = await sb.from("pilot_taste_scores").upsert(row, { onConflict: "work_id" })
  if (error) return { ok: false, error: error.message }

  // A nota de gosto passou a SER a nota pessoal (`user_score`) — o rótulo que treina o Ridge do
  // dono, a Chance e o ledger de previsão. Deriva-a dos 7 eixos fixos (sem o Final) e persiste no
  // ESPELHO DO DONO. `pilot_taste_scores` é o experimento do dono, então o rótulo é dele.
  await applyTasteDerivedUserScore(workId, scores)

  return { ok: true }
}

/**
 * Grava o `user_score` derivado do gosto na linha do DONO e roda o mesmo pós-processamento que
 * `updateWorkStatus` faz quando a nota muda: ledger prospectivo + recalc pendente.
 *
 * - Só grava quando os 7 eixos fixos estão completos (`computeTasteUserScore` → null caso falte).
 * - Só grava quando o estado de leitura passa no gate (`canRateReadingState`).
 * - No-op quando o rótulo não mudou (evita churn de ledger/recalc no autosave por estrela).
 * - `mirrorOwnerState` (service role, dono explícito): é caminho de curadoria em background, não
 *   uma escrita de sessão — o cliente de sessão negaria por RLS quando roda fora de request.
 * - O ledger é best-effort (telemetria) e captura a previsão PRÉ-rótulo: o recalc é DEFERIDO
 *   (`markRecalcPending`), então `calculated_scores` ainda é pré-rótulo na hora do capture.
 */
async function applyTasteDerivedUserScore(
  workId: string,
  scores: Partial<Record<TasteScoreKey, number | null>>,
): Promise<void> {
  const label = computeTasteUserScore(scores)
  if (label == null) return // faltam eixos — não gravamos média parcial (ver computeTasteUserScore)

  const ownerId = await getOwnerUserId()
  const supabase = createAdminClient()

  const { data: prevRow } = await supabase
    .from("user_work_state")
    .select("user_score, personal_status_id, chapters_read")
    .eq("user_id", ownerId)
    .eq("work_id", workId)
    .maybeSingle()
  const prevUserScore = (prevRow?.user_score as number | null | undefined) ?? null

  // "Só avalia quem leu" (lib/reading-gate.ts). O `/pilot-taste` lista obras que JÁ têm nota, e
  // a UI da página da obra esconde o card de gosto sem leitura suficiente — mas nenhuma das duas
  // é regra: esta action é endpoint público, e é por aqui que a nota de gosto vira `user_score`.
  // Sem o gate, uma obra cujo estado de leitura regrediu continuava tendo a nota REESCRITA a
  // cada estrela clicada. As notas de gosto em si (`pilot_taste_scores`) já foram salvas — é o
  // rótulo derivado que fica de fora.
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

  const mirror = await mirrorOwnerState(ownerId, [workId], { user_score: label })
  if (mirror.error) {
    console.error("[savePilotTaste] falha gravando user_score do dono:", mirror.error)
    return
  }

  // Validação prospectiva: primeira nota (null → valor) congela a previsão de-registro antes do
  // recalc deferido incluir o rótulo. Edição resolve/relabel. Idênticos aos ramos de updateWorkStatus.
  if (prevUserScore == null) {
    await capturePredictionForFirstRating(workId, label)
  }
  await resolvePredictionsForWork(workId, label)

  await markRecalcPending("savePilotTaste")
  revalidatePath(`/titles/${workId}`)
}
