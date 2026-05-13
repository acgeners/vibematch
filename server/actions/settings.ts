"use server"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { recalculateAll } from "./calculations"
import { computeCalibration, type CalibrationDiff } from "@/lib/calculations/calibration"

const execFileAsync = promisify(execFile)

export interface ScoreWeightUpdate {
  slug: string
  weight: number
  max_negative_threshold?: number | null
}

export async function updateScoreWeights(updates: ScoreWeightUpdate[]) {
  const supabase = await createClient()

  for (const u of updates) {
    await supabase
      .from("score_weights")
      .update({
        weight: u.weight,
        max_negative_threshold: u.max_negative_threshold ?? null,
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

export interface FormulaConfigUpdate {
  mae_calc: number
  mae_predicted: number
  pseudo_votes_nota_m: number
  pseudo_votes_blend: number
}

export interface RankingPreferencesUpdate {
  top_n: number | null
  min_calc_score: number | null
  min_predicted_score: number | null
  min_final_score: number | null
}

export async function updateRankingPreferences(update: RankingPreferencesUpdate) {
  const supabase = await createClient()

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

export async function updateFormulaConfig(update: FormulaConfigUpdate) {
  const supabase = await createClient()

  await supabase
    .from("formula_config")
    .update({
      ...update,
      updated_at: new Date().toISOString(),
    })
    .limit(1)

  const result = await recalculateAll()

  revalidatePath("/settings")
  revalidatePath("/ranking")
  return result
}

/**
 * Lê uma "fotografia" da calibração atual diretamente do estado do DB —
 * sem retreinar nada. Útil pra exibir métricas em /settings.
 */
export async function getCalibrationSnapshot() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("works")
    .select(
      `id, title, manual_score,
       calculated_scores(calc_score, predicted_score, final_score, total_votes, predicted_is_stub)`
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
    }
  })

  const calibration = computeCalibration(items)

  return {
    totalWorks: items.length,
    trainSize: calibration.trainSize,
    maeCalc: calibration.maeCalc,
    maePredicted: calibration.maePredicted,
    maeFinal: calibration.maeFinal,
    pseudoVotesNotaM: calibration.pseudoVotesNotaM,
    pseudoVotesBlend: calibration.pseudoVotesBlend,
    worstDiffs: calibration.worstDiffs as CalibrationDiff[],
    predictorIsStub: items.some((it) => it.predictedIsStub),
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
