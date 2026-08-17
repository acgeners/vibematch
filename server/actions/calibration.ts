"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { recalculateScoresNowResult } from "@/server/recalc/queue"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import { ensureAdmin } from "@/server/queries/current-user"

/**
 * Regenera os artefatos derivados do offset de atributos (Fase 1.5.5).
 * Disparar após mudanças relevantes no bias (novos questionários pós-leitura):
 *   1. Reconstrói o TasteProfile — agora sobre categoryScores calibrados.
 *   2. Marca os alignment_score persistidos como stale (foram computados com
 *      bias/perfil antigos). Reset pra false na próxima run de Smart Shortlist.
 *   3. recalculateAll() — re-treina o Ridge e re-prediz com o bias atual.
 */
export async function regenerateCalibratedArtifacts(): Promise<
  | {
      ok: true
      tasteProfileRegenerated: boolean
      alignmentRowsMarkedStale: number
      worksRecalculated: number
    }
  | { ok: false; error: string }
> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()

  // 1. TasteProfile (LLM, sobre rated works calibrados).
  const profileResult = await generateTasteProfileAction()
  if (profileResult.error) {
    return { ok: false, error: `Falha regenerando TasteProfile: ${profileResult.error}` }
  }

  // 2. Marca alignment stale onde há score persistido — na linha compartilhada
  // (dono) E em todo user_calculated_scores (demais usuários com Veredito IA
  // próprio; ver markWorkAlignmentStale em server/queries/alignment.ts).
  const [staleResult, personalStaleResult] = await Promise.all([
    supabase
      .from("calculated_scores")
      .update({ alignment_stale: true })
      .not("alignment_score", "is", null)
      .select("work_id"),
    supabase
      .from("user_calculated_scores")
      .update({ alignment_stale: true })
      .not("alignment_score", "is", null),
  ])
  const { data: staleRows, error: staleErr } = staleResult
  if (staleErr) {
    return { ok: false, error: `Falha marcando alignment stale: ${staleErr.message}` }
  }
  if (personalStaleResult.error) {
    console.warn(
      "[calibration] falha marcando alignment stale pessoal:",
      personalStaleResult.error.message,
    )
  }

  // 3. Recalcula tudo com o bias atual.
  const recalc = await recalculateScoresNowResult()

  revalidatePath("/curation/settings/calibration")
  revalidatePath("/ranking")

  return {
    ok: true,
    tasteProfileRegenerated: profileResult.data?.is_stub === false,
    alignmentRowsMarkedStale: staleRows?.length ?? 0,
    worksRecalculated: recalc.recalculated ?? 0,
  }
}
