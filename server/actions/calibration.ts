"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { MODEL, PROMPT_VERSION, requestBiasReport } from "@/lib/ai-calibration/service"
import { loadInputsForBias, loadLastRun } from "@/server/queries/calibration"
import { recalculateScoresNowResult } from "@/server/recalc/queue"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import type { CalibrationRunRow } from "@/lib/ai-calibration/types"
import { ensureAdmin } from "@/server/queries/current-user"


/**
 * Run em `processing` mais velho que isto está morto — o processo caiu sem gravar `failed`.
 * Vivia em `lib/ai-calibration/policy.ts`, que saiu com a auditoria.
 */
const STALE_RUN_HOURS = 6

/**
 * Runs presos em `processing` são processo morto — o caller caiu antes do `failed`.
 * Expira ANTES de criar o run novo: é o único momento em que se sabe que ninguém está
 * mais esperando por eles, e é write path (leitura não deve consertar dado).
 */
async function expireStaleRuns(): Promise<void> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - STALE_RUN_HOURS * 3600_000).toISOString()
  const { error } = await supabase
    .from("calibration_runs")
    .update({
      status: "failed",
      error_message: `Run abandonado: seguia "processing" após ${STALE_RUN_HOURS}h.`,
      completed_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("created_at", cutoff)
  if (error) console.error("[calibration] erro expirando runs presos:", error.message)
}







export async function runBiasReportAction(): Promise<{
  data?: CalibrationRunRow
  error?: string
}> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  await expireStaleRuns()
  const tasteProfile = await loadCurrentTasteProfile()

  const { data: runRow, error: insertError } = await supabase
    .from("calibration_runs")
    .insert({
      mode: "bias",
      status: "processing",
      model_name: MODEL,
      prompt_version: PROMPT_VERSION,
      taste_profile_id: tasteProfile?.id ?? null,
    })
    .select("id")
    .single()

  if (insertError || !runRow) return { error: insertError?.message ?? "Falha criando run." }
  const runId = runRow.id as string

  try {
    const inputs = await loadInputsForBias()
    if (inputs.stats.every((s) => s.n === 0)) {
      const errMsg = "Nenhuma obra com user_score — não há sinal pra detectar viés."
      await supabase
        .from("calibration_runs")
        .update({
          status: "failed",
          error_message: errMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId)
      return { error: errMsg }
    }

    const result = await requestBiasReport(inputs, { runId })

    const { data: updated, error: updError } = await supabase
      .from("calibration_runs")
      .update({
        status: "completed",
        n_works_scanned: Math.max(...inputs.stats.map((s) => s.n)),
        bias_report: result.report,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        ai_api_call_ids: result.apiCallId ? [result.apiCallId] : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .select("*")
      .single()

    if (updError || !updated) {
      return { error: updError?.message ?? "Falha gravando relatório." }
    }

    revalidatePath("/curation/settings/calibration")
    return { data: updated as unknown as CalibrationRunRow }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido"
    await supabase
      .from("calibration_runs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
    return { error: message }
  }
}

export async function getLastRunsAction(): Promise<{
  lastAudit: CalibrationRunRow | null
  lastBias: CalibrationRunRow | null
}> {
  const [audit, bias] = await Promise.all([loadLastRun("audit"), loadLastRun("bias")])
  return { lastAudit: audit, lastBias: bias }
}

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
