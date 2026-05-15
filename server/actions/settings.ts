"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { recalculateAll } from "./calculations"
import { computeCalibration, type CalibrationDiff } from "@/lib/calculations/calibration"

const execFileAsync = promisify(execFile)

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

export async function getCalibrationSnapshot() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("works")
    .select(
      `id, title, manual_score,
       calculated_scores(calc_score, predicted_score, final_score, total_votes, predicted_is_stub, prediction_distance)`
    )
    .eq("is_archived", false)
    .limit(2000)

  if (error) throw new Error(error.message)

  const items = (data ?? []).map((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (w as any).calculated_scores as any
    return {
      workId: w.id as string,
      title: (w as { title: string }).title,
      manualScore: w.manual_score == null ? null : Number(w.manual_score),
      calcScore: cs?.calc_score == null ? null : Number(cs.calc_score),
      predictedScore: cs?.predicted_score == null ? null : Number(cs.predicted_score),
      finalScore: cs?.final_score == null ? null : Number(cs.final_score),
      totalVotes: Number(cs?.total_votes ?? 0),
      predictedIsStub: Boolean(cs?.predicted_is_stub ?? true),
      predictionDistance: cs?.prediction_distance == null ? null : Number(cs.prediction_distance),
    }
  })

  const calibration = computeCalibration(items)

  const distanceBuckets: DistanceBucket[] = DISTANCE_BUCKETS.map((b) => ({
    label: b.label,
    count: items.filter(
      (it) => it.predictionDistance != null && it.predictionDistance >= b.min && it.predictionDistance < b.max
    ).length,
  }))

  return {
    totalWorks: items.length,
    trainSize: calibration.trainSize,
    maeCalc: calibration.maeCalc,
    maePredicted: calibration.maePredicted,
    maeFinal: calibration.maeFinal,
    rmseCalc: calibration.rmseCalc,
    rmsePredicted: calibration.rmsePredicted,
    rmseFinal: calibration.rmseFinal,
    pseudoVotesNotaM: calibration.pseudoVotesNotaM,
    pseudoVotesBlend: calibration.pseudoVotesBlend,
    worstDiffs: calibration.worstDiffs as CalibrationDiff[],
    predictorIsStub: items.some((it) => it.predictedIsStub),
    distanceBuckets,
    worksWithDistance: items.filter((it) => it.predictionDistance != null).length,
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
