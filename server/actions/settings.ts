"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { recalculateAll } from "./calculations"
import {
  computeCalibration,
  computeBucketBreakdown,
  type BucketBreakdown,
  type CalibrationDiff,
} from "@/lib/calculations/calibration"

const execFileAsync = promisify(execFile)

/**
 * Liga/desliga o stacker. Quando true, `recalculateAll` usa o Ridge segundo-nível
 * pra produzir `final_score`; quando false, mantém inverse-variance legado.
 * Dispara recalc automaticamente pra `final_score` refletir a escolha.
 */
export async function setStackerEnabled(enabled: boolean) {
  const supabase = createAdminClient()
  const { data: config } = await supabase
    .from("formula_config")
    .select("id")
    .limit(1)
    .single()
  if (!config) throw new Error("formula_config não encontrado")

  const { error } = await supabase
    .from("formula_config")
    .update({ stacker_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", config.id)
  if (error) throw new Error(error.message)

  const result = await recalculateAll()
  revalidatePath("/settings")
  revalidatePath("/ranking")
  revalidatePath("/titles")
  return result
}

/**
 * Liga/desliga o uso de pesos inferidos automaticamente no GPT calc.
 * Quando true (default), recalculateAll usa pesos do weight-inference.
 * Quando false, usa pesos manuais persistidos em `score_weights`.
 * Dispara recálculo automático pra refletir a mudança imediatamente.
 */
export async function setScoreWeightsAuto(enabled: boolean) {
  const supabase = createAdminClient()
  const { data: config } = await supabase
    .from("formula_config")
    .select("id")
    .limit(1)
    .single()
  if (!config) throw new Error("formula_config não encontrado")

  const { error } = await supabase
    .from("formula_config")
    .update({ score_weights_auto: enabled, updated_at: new Date().toISOString() })
    .eq("id", config.id)
  if (error) throw new Error(error.message)

  const result = await recalculateAll()
  revalidatePath("/settings")
  revalidatePath("/preferences")
  revalidatePath("/ranking")
  revalidatePath("/titles")
  return result
}

export interface ScoreWeightUpdate {
  slug: string
  weight: number
  threshold?: number | null
}

export async function updateScoreWeights(updates: ScoreWeightUpdate[]) {
  const supabase = createAdminClient()

  for (const u of updates) {
    await supabase
      .from("score_weights")
      .update({
        weight: u.weight,
        threshold: u.threshold ?? null,
      })
      .eq("slug", u.slug)
  }

  // Ao mudar pesos, incrementar versão da fórmula e recalcular tudo
  const { data: config } = await supabase
    .from("formula_config")
    .select("formula_version")
    .limit(1)
    .single()

  if (config) {
    const currentVersion = config.formula_version
    const match = currentVersion.match(/v(\d+)/)
    const newVersion = match ? `v${parseInt(match[1]) + 1}` : "v2"

    await supabase
      .from("formula_config")
      .update({ formula_version: newVersion, updated_at: new Date().toISOString() })
      .eq("formula_version", currentVersion)
  }

  const result = await recalculateAll()

  revalidatePath("/settings")
  revalidatePath("/ranking")
  revalidatePath("/titles")
  return result
}

export interface RankingPreferencesUpdate {
  top_n: number | null
  min_calc_score: number | null
  min_predicted_score: number | null
  min_final_score: number | null
}

export interface AiEvalPreferencesUpdate {
  prompt_version_tolerance: number
  low_confidence_threshold: number
}

export async function updateAiEvalPreferences(update: AiEvalPreferencesUpdate) {
  const supabase = createAdminClient()
  const tolerance = Math.max(0, Math.floor(update.prompt_version_tolerance))
  const threshold = Math.min(1, Math.max(0, update.low_confidence_threshold))

  const { data: existing } = await supabase
    .from("formula_config")
    .select("id")
    .limit(1)
    .single()

  if (!existing) return { error: "formula_config não encontrado" }

  const { error } = await supabase
    .from("formula_config")
    .update({
      prompt_version_tolerance: tolerance,
      low_confidence_threshold: threshold,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)

  if (error) return { error: error.message }

  revalidatePath("/settings")
  revalidatePath("/ai-evaluation")
  return { error: null }
}

export interface ScoreColorPercentilesUpdate {
  score_color_pct_top: number
  score_color_pct_high: number
  score_color_pct_mid: number
  score_color_pct_low: number
}

export async function updateScoreColorPercentiles(update: ScoreColorPercentilesUpdate) {
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  const top = clamp(update.score_color_pct_top)
  const high = clamp(update.score_color_pct_high)
  const mid = clamp(update.score_color_pct_mid)
  const low = clamp(update.score_color_pct_low)

  if (!(low < mid && mid < high && high < top)) {
    return { error: "Percentis devem ser estritamente crescentes: baixo < médio < alto < topo." }
  }

  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from("formula_config")
    .select("id")
    .limit(1)
    .single()

  if (!existing) return { error: "formula_config não encontrado" }

  const { error } = await supabase
    .from("formula_config")
    .update({
      score_color_pct_top: top,
      score_color_pct_high: high,
      score_color_pct_mid: mid,
      score_color_pct_low: low,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)

  if (error) return { error: error.message }

  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/preferences")
  revalidatePath("/ranking")
  revalidatePath("/titles")
  revalidatePath("/")
  return { error: null }
}

export async function updateRankingPreferences(update: RankingPreferencesUpdate) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from("formula_config")
    .select("id")
    .limit(1)
    .single()

  if (!existing) return { error: "formula_config não encontrado" }

  const { error } = await supabase
    .from("formula_config")
    .update({
      top_n: update.top_n,
      min_calc_score: update.min_calc_score,
      min_predicted_score: update.min_predicted_score,
      min_final_score: update.min_final_score,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)

  if (error) return { error: error.message }

  revalidatePath("/settings")
  revalidatePath("/ranking")
  return { error: null }
}

/**
 * Lê uma "fotografia" da calibração atual diretamente do estado do DB —
 * sem retreinar nada. Útil pra exibir métricas em /settings.
 */
const DISTANCE_BUCKETS = [
  { label: "< 0.5", min: 0, max: 0.5 },
  { label: "0.5–1", min: 0.5, max: 1 },
  { label: "1–2", min: 1, max: 2 },
  { label: "2–3", min: 2, max: 3 },
  { label: "≥ 3", min: 3, max: Infinity },
] as const

export interface DistanceBucket {
  label: string
  count: number
}

export interface CalibrationHistoryEntry {
  recorded_at: string
  formula_version: string | null
  stacker_enabled: boolean | null
  mae_loocv_stacker: number | null
  mae_final: number | null
  mae_calc: number | null
  mae_predicted: number | null
  /** Fase 1 shadow mode: MAE do expected_score (L1 Ridge cleaned). NULL em snapshots anteriores à migration 066. */
  mae_expected: number | null
  train_size: number | null
  total_works: number | null
}

export async function getCalibrationSnapshot() {
  const supabase = createAdminClient()

  const [worksRes, historyRes] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, title, user_score,
         calculated_scores(calc_score, predicted_score, final_score, total_votes, predicted_is_stub, prediction_distance, expected_score, expected_is_stub)`
      )
      .eq("is_archived", false)
      .limit(2000),
    supabase
      .from("calibration_history")
      .select(
        "recorded_at, formula_version, stacker_enabled, mae_loocv_stacker, mae_final, mae_calc, mae_predicted, mae_expected, train_size, total_works",
      )
      .order("recorded_at", { ascending: false })
      .limit(1000),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  // history error é não-fatal: tabela pode estar vazia ou indisponível em ambientes legados.
  const history = (historyRes.data ?? []) as CalibrationHistoryEntry[]

  const items = (worksRes.data ?? []).map((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (w as any).calculated_scores as any
    return {
      workId: w.id as string,
      title: (w as { title: string }).title,
      userScore: w.user_score == null ? null : Number(w.user_score),
      calcScore: cs?.calc_score == null ? null : Number(cs.calc_score),
      predictedScore: cs?.predicted_score == null ? null : Number(cs.predicted_score),
      finalScore: cs?.final_score == null ? null : Number(cs.final_score),
      totalVotes: Number(cs?.total_votes ?? 0),
      predictedIsStub: Boolean(cs?.predicted_is_stub ?? true),
      predictionDistance: cs?.prediction_distance == null ? null : Number(cs.prediction_distance),
      expectedScore: cs?.expected_score == null ? null : Number(cs.expected_score),
      expectedIsStub: cs?.expected_is_stub == null ? null : Boolean(cs.expected_is_stub),
    }
  })

  const calibration = computeCalibration(items)
  const buckets: BucketBreakdown = computeBucketBreakdown(items)

  const distanceBuckets: DistanceBucket[] = DISTANCE_BUCKETS.map((b) => ({
    label: b.label,
    count: items.filter(
      (it) => it.predictionDistance != null && it.predictionDistance >= b.min && it.predictionDistance < b.max
    ).length,
  }))

  // MAE in-sample do expected_score (L1 shadow). Mesma metodologia que mae_calc/
  // mae_predicted/mae_final: itens com user_score e expected_score preenchidos.
  // NULL quando ainda não há dado (pré-recálculo após migration 066) ou stub.
  let maeExpected: number | null = null
  let expectedCovered = 0
  let expectedSumAbs = 0
  for (const it of items) {
    if (it.userScore == null || it.expectedScore == null) continue
    expectedCovered += 1
    expectedSumAbs += Math.abs(it.expectedScore - it.userScore)
  }
  if (expectedCovered > 0) maeExpected = expectedSumAbs / expectedCovered

  return {
    totalWorks: items.length,
    trainSize: calibration.trainSize,
    maeCalc: calibration.maeCalc,
    maePredicted: calibration.maePredicted,
    maeFinal: calibration.maeFinal,
    maeExpected,
    rmseCalc: calibration.rmseCalc,
    rmsePredicted: calibration.rmsePredicted,
    rmseFinal: calibration.rmseFinal,
    pseudoVotesNotaM: calibration.pseudoVotesNotaM,
    pseudoVotesBlend: calibration.pseudoVotesBlend,
    worstDiffs: calibration.worstDiffs as CalibrationDiff[],
    predictorIsStub: items.some((it) => it.predictedIsStub),
    expectedPredictorIsStub: items.length > 0 && items.every((it) => it.expectedScore == null || it.expectedIsStub === true),
    expectedCoveredCount: expectedCovered,
    distanceBuckets,
    worksWithDistance: items.filter((it) => it.predictionDistance != null).length,
    buckets,
    history,
  }
}

/**
 * Força recalcular tudo (e re-calibrar formula_config automaticamente).
 */
export async function recalculateNow() {
  const result = await recalculateAll()
  revalidatePath("/settings")
  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/")
  return result
}

export interface ConsolidateSynopsesProgress {
  attempted: number
  consolidated: number
  skipped: number
  failed: number
  tokensIn: number
  tokensOut: number
  /** Se true, o lote foi interrompido cedo por falhas consecutivas na API. */
  abortedEarly?: boolean
}

/**
 * Roda a consolidação de sinopse (via Haiku) pra todas as obras que ainda
 * não têm `canonical_synopsis`. Limita por `maxWorks` (default 10 pra não
 * travar a UI). Aborta cedo se houver 3 falhas consecutivas de API (sinal
 * de Anthropic congestionada).
 */
export async function consolidatePendingSynopses(maxWorks = 10): Promise<{
  data?: ConsolidateSynopsesProgress
  error?: string
}> {
  try {
    const { consolidateSynopsisDetailed, hashSynopsisInputs } = await import(
      "@/lib/ai-recommendation/synopsis-consolidator"
    )
    const { splitSynopsesFromText } = await import("@/lib/work-derived")
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const supabase = createAdminClient()

    const { data: pending, error } = await supabase
      .from("works")
      .select("id, canonical_synopsis_inputs_hash, work_synopses(text)")
      .is("canonical_synopsis", null)
      .eq("is_archived", false)
      .limit(maxWorks)
    if (error) return { error: error.message }

    const progress: ConsolidateSynopsesProgress = {
      attempted: 0,
      consolidated: 0,
      skipped: 0,
      failed: 0,
      tokensIn: 0,
      tokensOut: 0,
    }

    let consecutiveApiFailures = 0
    const MAX_CONSECUTIVE_API_FAILURES = 3

    for (const row of pending ?? []) {
      progress.attempted += 1
      const rawTexts = (row.work_synopses as Array<{ text: string | null }> | null)
        ?.map((r) => (r.text ?? "").trim())
        .filter((t) => t.length > 0) ?? []
      if (rawTexts.length === 0) {
        progress.skipped += 1
        continue
      }
      const expanded = rawTexts.flatMap((t) => {
        const blocks = splitSynopsesFromText(t)
        return blocks.length > 0 ? blocks : [t]
      })
      const hash = hashSynopsisInputs(expanded)
      const status = await consolidateSynopsisDetailed(expanded, { workId: row.id as string })
      if (status.kind === "skipped") {
        progress.skipped += 1
        consecutiveApiFailures = 0
        continue
      }
      if (status.kind === "api_failed") {
        progress.failed += 1
        consecutiveApiFailures += 1
        if (consecutiveApiFailures >= MAX_CONSECUTIVE_API_FAILURES) {
          progress.abortedEarly = true
          break
        }
        continue
      }
      consecutiveApiFailures = 0
      const result = status.result
      const { error: upErr } = await supabase
        .from("works")
        .update({
          canonical_synopsis: result.canonical,
          canonical_synopsis_at: new Date().toISOString(),
          canonical_synopsis_inputs_hash: hash,
        })
        .eq("id", row.id)
      if (upErr) {
        console.error("[consolidatePendingSynopses] update falhou:", upErr)
        progress.failed += 1
        continue
      }
      progress.consolidated += 1
      progress.tokensIn += result.tokensIn
      progress.tokensOut += result.tokensOut
    }

    revalidatePath("/settings")
    return { data: progress }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao consolidar sinopses" }
  }
}

export interface ConsolidateReviewSummariesProgress {
  attempted: number
  summarized: number
  skipped: number
  failed: number
  tokensIn: number
  tokensOut: number
  /** Se true, o lote foi interrompido cedo por falhas consecutivas na API. */
  abortedEarly?: boolean
}

/**
 * Gera o resumo IA das reviews (via Haiku) pras obras que têm reviews salvas
 * mas ainda não têm `review_summary`. Espelha `consolidatePendingSynopses`:
 * limita por `maxWorks` e aborta cedo após 3 falhas de API consecutivas.
 */
export async function consolidatePendingReviewSummaries(maxWorks = 10): Promise<{
  data?: ConsolidateReviewSummariesProgress
  error?: string
}> {
  try {
    const { consolidateReviewsDetailed, hashReviewInputs } = await import(
      "@/lib/ai-recommendation/review-summarizer"
    )
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const supabase = createAdminClient()

    // Coleta os work_ids distintos com reviews. work_reviews pode ter milhares de
    // linhas e o PostgREST capa em 1000 por página — então pagina até esgotar.
    // (Sem paginar, só as obras cujas reviews caem nas primeiras 1000 linhas
    // entrariam no lote, e o backfill nunca chegaria no resto.)
    const reviewedIds = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("work_reviews")
        .select("work_id")
        .range(from, from + PAGE - 1)
      if (error) return { error: error.message }
      for (const r of data ?? []) reviewedIds.add(r.work_id as string)
      if (!data || data.length < PAGE) break
    }

    const progress: ConsolidateReviewSummariesProgress = {
      attempted: 0,
      summarized: 0,
      skipped: 0,
      failed: 0,
      tokensIn: 0,
      tokensOut: 0,
    }
    if (reviewedIds.size === 0) return { data: progress }

    const ids = [...reviewedIds]
    const { data: workRows, error: workErr } = await supabase
      .from("works")
      .select("id, review_summary")
      .in("id", ids)
    if (workErr) return { error: workErr.message }
    const pendingIds = (workRows ?? [])
      .filter((w) => (w as { review_summary: string | null }).review_summary == null)
      .map((w) => w.id as string)
      .slice(0, maxWorks)

    let consecutiveApiFailures = 0
    const MAX_CONSECUTIVE_API_FAILURES = 3

    for (const id of pendingIds) {
      progress.attempted += 1
      // Reviews da obra por work_id — uma obra tem dezenas de reviews, bem abaixo
      // do cap de 1000, então pega todas sem paginar.
      const { data: revRows } = await supabase
        .from("work_reviews")
        .select("text, user_rating")
        .eq("work_id", id)
      const inputs = (revRows ?? []).map((r) => ({
        text: (r.text as string | null) ?? "",
        userRating: r.user_rating != null ? Number(r.user_rating) : null,
      }))
      const status = await consolidateReviewsDetailed(inputs, { workId: id })
      if (status.kind === "skipped") {
        progress.skipped += 1
        consecutiveApiFailures = 0
        continue
      }
      if (status.kind === "api_failed") {
        progress.failed += 1
        consecutiveApiFailures += 1
        if (consecutiveApiFailures >= MAX_CONSECUTIVE_API_FAILURES) {
          progress.abortedEarly = true
          break
        }
        continue
      }
      consecutiveApiFailures = 0
      const result = status.result
      const { error: upErr } = await supabase
        .from("works")
        .update({
          review_summary: result.summary,
          review_summary_at: new Date().toISOString(),
          review_summary_inputs_hash: hashReviewInputs(inputs),
        })
        .eq("id", id)
      if (upErr) {
        console.error("[consolidatePendingReviewSummaries] update falhou:", upErr)
        progress.failed += 1
        continue
      }
      progress.summarized += 1
      progress.tokensIn += result.tokensIn
      progress.tokensOut += result.tokensOut
    }

    revalidatePath("/settings")
    return { data: progress }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao resumir reviews" }
  }
}

export async function syncConstantsNow() {
  try {
    const { stdout, stderr } = await execFileAsync("npm", ["run", "sync-constants"], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 10,
    })

    revalidatePath("/settings")
    revalidatePath("/titles")
    revalidatePath("/ranking")
    revalidatePath("/")

    return {
      ok: true,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    }
  } catch (err) {
    const output =
      err && typeof err === "object" && "stdout" in err
        ? `${String(err.stdout ?? "")}\n${String("stderr" in err ? err.stderr ?? "" : "")}`.trim()
        : ""

    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erro ao sincronizar constantes",
      output,
    }
  }
}
