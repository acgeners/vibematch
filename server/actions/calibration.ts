"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  MODEL,
  PROMPT_VERSION,
  requestBiasReport,
  requestCalibrationAudit,
  type TokenUsage,
} from "@/lib/ai-calibration/service"
import {
  changedAuditWorkIdsSince,
  loadInputsForBias,
  loadLastRun,
  loadWorksForAudit,
} from "@/server/queries/calibration"
import { markRecalcPending, recalculateScoresNowResult } from "@/server/recalc/queue"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import type {
  AuditSuggestionFromModel,
  AuditWorkInput,
  CalibrationRunRow,
  SuggestionRow,
} from "@/lib/ai-calibration/types"
import type { ScoreSource } from "@/types/domain"
import { ensureAdmin } from "@/server/queries/current-user"

// 10 obras/chunk: o modelo emite um objeto audits[] por inconsistência (com
// justification em PT), e 40 obras estouravam o teto de max_tokens da saída —
// truncando o tool_use e devolvendo 0 sugestões silenciosamente. Ver guard de
// stop_reason="max_tokens" em lib/ai-calibration/service.ts.
const AUDIT_CHUNK_SIZE = 10
const AUDIT_PARALLEL = 3
const DEFAULT_AUTO_APPLY_MIN_CONFIDENCE = 0.8
const DEFAULT_AUTO_APPLY_MAX_DELTA = 1.5
const LOCKED_SOURCES: ReadonlySet<ScoreSource> = new Set(["manual", "ai_edited"])

interface RunUsageAccumulator {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

function accumulateUsage(acc: RunUsageAccumulator, u: TokenUsage) {
  if (u.inputTokens) acc.inputTokens += u.inputTokens
  if (u.outputTokens) acc.outputTokens += u.outputTokens
  if (u.cacheReadTokens) acc.cacheReadTokens += u.cacheReadTokens
  if (u.cacheCreationTokens) acc.cacheCreationTokens += u.cacheCreationTokens
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit)
    const batch = await Promise.all(slice.map((item, j) => fn(item, i + j)))
    results.push(...batch)
  }
  return results
}

export interface RunAuditResult {
  /** `null` quando não houve run (nada mudou / pool vazia). */
  runId: string | null
  /** `full` = varreu a pool inteira; `incremental` = só as obras que mudaram. */
  scope: "full" | "incremental"
  nWorksScanned: number
  nSuggestions: number
  nAutoApplied: number
  usage: RunUsageAccumulator
}

const EMPTY_USAGE: RunUsageAccumulator = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}

export async function runCalibrationAuditAction(
  opts: { full?: boolean } = {},
): Promise<{
  data?: RunAuditResult
  error?: string
}> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()

  // ── Escopo: incremental (só as obras que mudaram) por padrão; varredura COMPLETA quando o
  // chamador pede `full`, quando a régua mudou (modelo/prompt) ou quando nunca rodou — nesses
  // casos TODAS as obras estão stale. Decidido ANTES de criar o run row pra não gravar um run
  // vazio quando nada mudou (isso só avançaria o `since` à toa).
  const lastRun = await loadLastRun("audit")
  const driftOrNever =
    !lastRun || lastRun.model_name !== MODEL || lastRun.prompt_version !== PROMPT_VERSION
  const fullScan = opts.full === true || driftOrNever
  const scope: RunAuditResult["scope"] = fullScan ? "full" : "incremental"

  let works: AuditWorkInput[]
  if (fullScan) {
    works = await loadWorksForAudit()
  } else {
    // O MESMO conjunto que o nudge conta em `loadAuditStaleness` (score ∪ critério na pool).
    // Cadeia completa: cada run varre tudo que mudou desde o run anterior e avança `completed_at`,
    // então nenhuma obra escapa entre runs. Borda aceita: uma mudança feita DURANTE o run anterior
    // (após o read, antes do completed_at) pode passar batida — auto-cura na próxima edição da obra
    // (a alternativa, usar created_at, re-auditaria obras já cobertas).
    const since = lastRun!.completed_at ?? lastRun!.created_at
    const changedIds = await changedAuditWorkIdsSince(since)
    if (changedIds.length === 0) {
      // Nada mudou desde o último run — não cria run vazio.
      return {
        data: { runId: null, scope, nWorksScanned: 0, nSuggestions: 0, nAutoApplied: 0, usage: EMPTY_USAGE },
      }
    }
    works = await loadWorksForAudit({ onlyIds: changedIds })
  }

  if (works.length === 0) {
    // Pool vazia (full scan sem obras avaliadas) — nada a fazer, sem run.
    return {
      data: { runId: null, scope, nWorksScanned: 0, nSuggestions: 0, nAutoApplied: 0, usage: EMPTY_USAGE },
    }
  }

  const tasteProfile = await loadCurrentTasteProfile()
  const { data: runRow, error: insertError } = await supabase
    .from("calibration_runs")
    .insert({
      mode: "audit",
      status: "processing",
      model_name: MODEL,
      prompt_version: PROMPT_VERSION,
      taste_profile_id: tasteProfile?.id ?? null,
      auto_apply_min_confidence: DEFAULT_AUTO_APPLY_MIN_CONFIDENCE,
      auto_apply_max_delta: DEFAULT_AUTO_APPLY_MAX_DELTA,
    })
    .select("id")
    .single()

  if (insertError || !runRow) {
    return { error: insertError?.message ?? "Falha criando run." }
  }
  const runId = runRow.id as string

  try {
    const chunks = chunk(works, AUDIT_CHUNK_SIZE)
    const usage: RunUsageAccumulator = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }

    const allSuggestions: AuditSuggestionFromModel[] = []
    const apiCallIds: string[] = []
    const results = await runWithLimit(chunks, AUDIT_PARALLEL, (group, idx) =>
      requestCalibrationAudit(group, { runId, chunkIndex: idx }),
    )
    for (const r of results) {
      allSuggestions.push(...r.suggestions)
      accumulateUsage(usage, r.usage)
      if (r.apiCallId) apiCallIds.push(r.apiCallId)
    }

    const worksById = new Map<string, AuditWorkInput>(works.map((w) => [w.workId, w]))
    let nAutoApplied = 0
    let nInserted = 0

    for (const sug of allSuggestions) {
      const work = worksById.get(sug.workId)
      if (!work) continue
      const current = work.categoryScores[sug.criterionSlug]
      if (!current) continue
      // Nunca toca em scores travados pelo usuário, mesmo que o prompt tenha
      // ignorado a instrução.
      if (LOCKED_SOURCES.has(current.source)) continue

      const delta = sug.suggestedScore - current.score
      if (Math.abs(delta) < 0.5) continue

      const shouldAutoApply =
        sug.confidence >= DEFAULT_AUTO_APPLY_MIN_CONFIDENCE &&
        Math.abs(delta) <= DEFAULT_AUTO_APPLY_MAX_DELTA

      const status: SuggestionRow["status"] = shouldAutoApply ? "auto_applied" : "pending"
      const appliedScore = shouldAutoApply ? sug.suggestedScore : null
      const appliedAt = shouldAutoApply ? new Date().toISOString() : null

      // Substitui a pendente ANTERIOR do mesmo (obra, atributo): esta run é um
      // julgamento mais fresco. Sem isso, rodar a auditoria de novo empilha
      // duplicatas (e violaria o índice único parcial de pendentes da mig 129).
      const { error: supersedeError } = await supabase
        .from("score_calibration_suggestions")
        .update({ status: "superseded", reviewed_at: new Date().toISOString() })
        .eq("work_id", sug.workId)
        .eq("criterion_slug", sug.criterionSlug)
        .eq("status", "pending")
      if (supersedeError) {
        console.error("[calibration] erro substituindo pendente anterior:", supersedeError)
      }

      const { error: sugError } = await supabase
        .from("score_calibration_suggestions")
        .insert({
          run_id: runId,
          work_id: sug.workId,
          criterion_slug: sug.criterionSlug,
          previous_score: current.score,
          previous_source: current.source,
          suggested_score: sug.suggestedScore,
          delta,
          confidence: sug.confidence,
          justification: sug.justification,
          status,
          applied_score: appliedScore,
          applied_at: appliedAt,
        })
      if (sugError) {
        console.error("[calibration] erro inserindo sugestão:", sugError)
        continue
      }
      nInserted += 1

      if (shouldAutoApply) {
        const { error: updError } = await supabase
          .from("category_scores")
          .update({
            score: sug.suggestedScore,
            source: "ai_calibrated",
            ai_evaluation_id: null,
          })
          .eq("work_id", sug.workId)
          .eq("criterion_slug", sug.criterionSlug)
        if (updError) {
          console.error("[calibration] erro aplicando score:", updError)
          continue
        }
        nAutoApplied += 1
      }
    }

    await supabase
      .from("calibration_runs")
      .update({
        status: "completed",
        n_works_scanned: works.length,
        n_suggestions: nInserted,
        n_auto_applied: nAutoApplied,
        input_tokens: usage.inputTokens || null,
        output_tokens: usage.outputTokens || null,
        cache_read_tokens: usage.cacheReadTokens || null,
        cache_creation_tokens: usage.cacheCreationTokens || null,
        ai_api_call_ids: apiCallIds.length > 0 ? apiCallIds : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)

    // Não recalcula na hora: marca a base como pendente (igual a edição de obra).
    // O usuário dispara pelo banner "Recalcular notas" — ou o auto-recalc de 1h.
    if (nAutoApplied > 0) {
      await markRecalcPending("calibration-auto-apply")
    }

    revalidatePath("/settings/calibration")
    return {
      data: {
        runId,
        scope,
        nWorksScanned: works.length,
        nSuggestions: nInserted,
        nAutoApplied: nAutoApplied,
        usage,
      },
    }
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

export async function runBiasReportAction(): Promise<{
  data?: CalibrationRunRow
  error?: string
}> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
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

    revalidatePath("/settings/calibration")
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

async function applySuggestionWithConflictCheck(
  suggestionId: string,
  appliedScore: number,
  newStatus: "accepted" | "edited",
): Promise<{ ok: true; workId: string } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  const { data: sug, error: sugError } = await supabase
    .from("score_calibration_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .single()
  if (sugError || !sug) return { ok: false, error: sugError?.message ?? "Sugestão não encontrada." }
  if (sug.status !== "pending") {
    return { ok: false, error: `Sugestão já em status ${sug.status}.` }
  }

  const { data: current, error: currentError } = await supabase
    .from("category_scores")
    .select("source, score")
    .eq("work_id", sug.work_id)
    .eq("criterion_slug", sug.criterion_slug)
    .single()
  if (currentError || !current) {
    return { ok: false, error: "Score atual não encontrado pra esta obra/critério." }
  }
  if (LOCKED_SOURCES.has(current.source as ScoreSource)) {
    await supabase
      .from("score_calibration_suggestions")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", suggestionId)
    return {
      ok: false,
      error: `Conflito: score virou "${current.source}" (edição manual). Sugestão marcada como rejeitada.`,
    }
  }

  const { error: updError } = await supabase
    .from("category_scores")
    .update({
      score: appliedScore,
      source: "ai_calibrated" as ScoreSource,
      ai_evaluation_id: null,
    })
    .eq("work_id", sug.work_id)
    .eq("criterion_slug", sug.criterion_slug)
  if (updError) return { ok: false, error: updError.message }

  await supabase
    .from("score_calibration_suggestions")
    .update({
      status: newStatus,
      applied_score: appliedScore,
      applied_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", suggestionId)

  return { ok: true, workId: sug.work_id }
}

export async function acceptSuggestionAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()
  const { data: sug, error } = await supabase
    .from("score_calibration_suggestions")
    .select("suggested_score, work_id")
    .eq("id", id)
    .single()
  if (error || !sug) return { ok: false, error: error?.message ?? "Sugestão não encontrada." }

  const res = await applySuggestionWithConflictCheck(id, Number(sug.suggested_score), "accepted")
  if (!res.ok) return { ok: false, error: res.error }
  await markRecalcPending("calibration-accept")
  revalidatePath("/settings/calibration")
  return { ok: true }
}

export async function editSuggestionAction(
  id: string,
  score: number,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return { ok: false, error: "Score precisa estar entre 0 e 10." }
  }
  const res = await applySuggestionWithConflictCheck(id, score, "edited")
  if (!res.ok) return { ok: false, error: res.error }
  await markRecalcPending("calibration-edit")
  revalidatePath("/settings/calibration")
  return { ok: true }
}

export async function rejectSuggestionAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("score_calibration_suggestions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings/calibration")
  return { ok: true }
}

export async function revertSuggestionAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()
  const { data: sug, error } = await supabase
    .from("score_calibration_suggestions")
    .select("*")
    .eq("id", id)
    .single()
  if (error || !sug) return { ok: false, error: error?.message ?? "Sugestão não encontrada." }
  if (!["auto_applied", "accepted", "edited"].includes(sug.status)) {
    return { ok: false, error: `Não é possível reverter sugestão em status ${sug.status}.` }
  }

  const { error: updError } = await supabase
    .from("category_scores")
    .update({
      score: Number(sug.previous_score),
      source: sug.previous_source as ScoreSource,
    })
    .eq("work_id", sug.work_id)
    .eq("criterion_slug", sug.criterion_slug)
  if (updError) return { ok: false, error: updError.message }

  await supabase
    .from("score_calibration_suggestions")
    .update({
      status: "reverted",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)

  await markRecalcPending("calibration-revert")
  revalidatePath("/settings/calibration")
  return { ok: true }
}

export async function bulkAcceptAction(args: {
  minConfidence: number
  maxAbsDelta?: number
  /** Aceita só sugestões com |Δ| ≥ este valor (espelha o filtro "|Δ| mínimo" da UI). */
  minAbsDelta?: number
  /** Restringe a um critério (espelha o filtro "Critério" da UI). */
  criterionSlug?: string
}): Promise<{ accepted: number; failed: number; errors: string[] }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { accepted: 0, failed: 0, errors: [gate.error] }
  const supabase = createAdminClient()
  let query = supabase
    .from("score_calibration_suggestions")
    .select("id, suggested_score, confidence, delta")
    .eq("status", "pending")
    .gte("confidence", args.minConfidence)
  if (args.criterionSlug) query = query.eq("criterion_slug", args.criterionSlug)
  const { data, error } = await query
  if (error) return { accepted: 0, failed: 0, errors: [error.message] }

  const filtered = (data ?? []).filter((s) => {
    const delta = Math.abs(Number(s.delta))
    if (args.maxAbsDelta != null && delta > args.maxAbsDelta) return false
    if (args.minAbsDelta != null && delta < args.minAbsDelta) return false
    return true
  })

  let accepted = 0
  let failed = 0
  const errors: string[] = []
  const workIds = new Set<string>()
  for (const s of filtered) {
    const res = await applySuggestionWithConflictCheck(
      s.id as string,
      Number(s.suggested_score),
      "accepted",
    )
    if (res.ok) {
      accepted += 1
      workIds.add(res.workId)
    } else {
      failed += 1
      if (errors.length < 5) errors.push(res.error)
    }
  }

  if (workIds.size > 0) {
    // Marca recálculo pendente (banner "Recalcular notas") em vez de rodar na
    // hora — igual a edição de obra. O usuário dispara quando terminar a revisão.
    await markRecalcPending("calibration-bulk")
  }

  revalidatePath("/settings/calibration")
  return { accepted, failed, errors }
}

/**
 * Aceita um conjunto EXPLÍCITO de sugestões (multi-select por checkbox).
 * Diferente do `bulkAcceptAction` (que age por filtro sobre o banco todo),
 * aqui o usuário escolheu linhas específicas. Ignora ids que não estão mais
 * pendentes. Marca recálculo pendente ao final (banner), sem recalcular na hora.
 */
export async function bulkAcceptByIdsAction(
  ids: string[],
): Promise<{ accepted: number; failed: number; errors: string[] }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { accepted: 0, failed: 0, errors: [gate.error] }
  if (ids.length === 0) return { accepted: 0, failed: 0, errors: [] }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("score_calibration_suggestions")
    .select("id, suggested_score")
    .in("id", ids)
    .eq("status", "pending")
  if (error) return { accepted: 0, failed: 0, errors: [error.message] }

  let accepted = 0
  let failed = 0
  const errors: string[] = []
  const workIds = new Set<string>()
  for (const s of data ?? []) {
    const res = await applySuggestionWithConflictCheck(
      s.id as string,
      Number(s.suggested_score),
      "accepted",
    )
    if (res.ok) {
      accepted += 1
      workIds.add(res.workId)
    } else {
      failed += 1
      if (errors.length < 5) errors.push(res.error)
    }
  }

  if (workIds.size > 0) {
    await markRecalcPending("calibration-bulk-ids")
  }

  revalidatePath("/settings/calibration")
  return { accepted, failed, errors }
}

/**
 * Rejeita um conjunto EXPLÍCITO de sugestões pendentes (multi-select por
 * checkbox). Não altera scores ⇒ não precisa recalcular.
 */
export async function bulkRejectByIdsAction(
  ids: string[],
): Promise<{ rejected: number; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { rejected: 0, error: gate.error }
  if (ids.length === 0) return { rejected: 0 }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("score_calibration_suggestions")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id")
  if (error) return { rejected: 0, error: error.message }
  revalidatePath("/settings/calibration")
  return { rejected: data?.length ?? 0 }
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

  revalidatePath("/settings/calibration")
  revalidatePath("/ranking")

  return {
    ok: true,
    tasteProfileRegenerated: profileResult.data?.is_stub === false,
    alignmentRowsMarkedStale: staleRows?.length ?? 0,
    worksRecalculated: recalc.recalculated ?? 0,
  }
}
