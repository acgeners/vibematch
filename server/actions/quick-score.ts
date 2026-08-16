"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { computeTasteUserScore, TASTE_SCORE_KEYS } from "@/server/queries/pilot-taste"
import type { TasteScoreKey } from "@/server/queries/pilot-taste"
import { resolveQuickScoreEffect } from "@/lib/onboarding/quick-score-precedence"
import { canRateReadingState } from "@/lib/reading-gate"
import { markRecalcPending } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { capturePredictionForFirstRating } from "./prediction-ledger"
import {
  resolvePredictionsForWork,
  discardPredictionsForWork,
} from "@/lib/server/predictions/resolve-prediction"

/** As 8 craft pós-leitura — presença de qualquer uma = ficha de craft começada. */
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
 * Nota rápida (0–10, 1 toque) de UMA obra, para QUEM ESTÁ LOGADO — o caminho de nota do
 * onboarding (obras marcadas "já li" no deck) e de qualquer lugar que queira nota sem ficha.
 *
 * A regra mora em `lib/onboarding/quick-score-precedence.ts`: a ficha completa SEMPRE
 * vence — aqui só acontece o write-through do rótulo quando NÃO há ficha, com o mesmo
 * pós-processamento dos outros caminhos de nota (ledger prospectivo + recalc; gate
 * "só avalia quem leu" no rótulo, nunca na guarda da nota rápida em si).
 */
export async function saveQuickScore(
  workId: string,
  score: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "workId ausente" }

  let value: number | null = null
  if (score != null) {
    const n = Number(score)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      return { ok: false, error: `nota inválida: ${score}` }
    }
    value = Math.round(n * 10) / 10
  }

  const supabase = createAdminClient()
  const [{ data: prevRow }, { data: workRow }, { data: tasteRow }] = await Promise.all([
    supabase
      .from("user_work_state")
      .select(`quick_score, user_score, personal_status_id, chapters_read, ${CRAFT_SCORE_COLUMNS.join(", ")}`)
      .eq("user_id", gate.userId)
      .eq("work_id", workId)
      .maybeSingle(),
    supabase.from("works").select("total_chapters").eq("id", workId).maybeSingle(),
    supabase
      .from("pilot_taste_scores")
      .select("*")
      .eq("user_id", gate.userId)
      .eq("work_id", workId)
      .maybeSingle(),
  ])

  const prev = (prevRow ?? {}) as Record<string, unknown>
  const tasteScores = {} as Partial<Record<TasteScoreKey, number | null>>
  for (const k of TASTE_SCORE_KEYS) {
    const v = (tasteRow as Record<string, unknown> | null)?.[k]
    tasteScores[k] = v == null ? null : Number(v)
  }
  const fichaExists =
    CRAFT_SCORE_COLUMNS.some((c) => prev[c] != null) || computeTasteUserScore(tasteScores) != null

  const canRate = canRateReadingState({
    personalStatus: (prev.personal_status_id as number | null | undefined) ?? null,
    chaptersRead: (prev.chapters_read as number | null | undefined) ?? null,
    totalChapters: (workRow?.total_chapters as number | null | undefined) ?? null,
  })

  const effect = resolveQuickScoreEffect({
    score: value,
    prevQuickScore: prev.quick_score == null ? null : Number(prev.quick_score),
    prevUserScore: prev.user_score == null ? null : Number(prev.user_score),
    fichaExists,
    canRate,
  })

  const write = await writeReadingState(gate.userId, [workId], effect.patch)
  if (write.error) return { ok: false, error: write.error }

  // Mesmo pós-processamento dos outros caminhos de rótulo (updateWorkStatus/savePilotTaste):
  // primeira nota congela a previsão de-registro; edição resolve; remoção descarta a medição.
  if (effect.labelChange === "first") {
    await capturePredictionForFirstRating(workId, value as number)
    await resolvePredictionsForWork(workId, value as number)
  } else if (effect.labelChange === "updated") {
    await resolvePredictionsForWork(workId, value as number)
  } else if (effect.labelChange === "removed") {
    await discardPredictionsForWork(workId)
  }

  if (effect.labelChange !== "none") {
    if (gate.isOwner) {
      await markRecalcPending("saveQuickScore")
    } else {
      after(async () => {
        try {
          await recalculateForUser(gate.userId)
        } catch (err) {
          console.error("[saveQuickScore] recalc do usuário falhou:", err)
        }
      })
    }
    revalidatePath(`/catalog/${workId}`)
  }

  return { ok: true }
}
