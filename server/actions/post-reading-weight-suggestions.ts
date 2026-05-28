"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import type { PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import {
  inferPostReadingWeights,
  POST_READING_FIELDS,
  type PostReadingScoreMap,
  type PostReadingWeightInferenceInput,
  type PostReadingWeightInferenceResult,
} from "@/lib/ml/post-reading-weight-inference"
import { recalculateAll } from "@/server/actions/calculations"

/**
 * Calcula sugestões de pesos pós-leitura a partir do histórico.
 *
 * Diferente do server action de pesos IA: não aplica nem persiste nada — pesos
 * pós-leitura vivem em localStorage no client, então a aplicação fica do lado
 * do componente. Server só roda Ridge e devolve diagnóstico.
 */
export async function suggestPostReadingWeights(
  currentWeights: Record<PostReadingScoreField, number>,
): Promise<PostReadingWeightInferenceResult> {
  const supabase = createAdminClient()

  const selectColumns = [
    "id",
    ...POST_READING_FIELDS,
    "calculated_scores(final_score)",
  ].join(", ")

  const { data, error } = await supabase
    .from("works")
    .select(selectColumns)
    .eq("is_archived", false)
    .limit(2000)

  if (error) throw new Error(error.message)

  const inputs: PostReadingWeightInferenceInput[] = (data ?? [])
    .map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any
      const cs = Array.isArray(r.calculated_scores)
        ? r.calculated_scores[0]
        : r.calculated_scores
      const target = cs?.final_score == null ? null : Number(cs.final_score)
      if (target == null || !Number.isFinite(target)) return null

      const postScores: PostReadingScoreMap = {}
      for (const field of POST_READING_FIELDS) {
        const v = r[field]
        postScores[field] = v == null ? null : Number(v)
      }
      return {
        workId: r.id as string,
        postScores,
        target,
      }
    })
    .filter((x): x is PostReadingWeightInferenceInput => x !== null)

  return inferPostReadingWeights(inputs, currentWeights)
}

/**
 * Aplica novos pesos pós-leitura: recalcula `works.user_score` pra toda obra
 * com pelo menos um `post_*_score` preenchido e dispara `recalculateAll()` pra
 * refrescar Nota.Calc/Pr/Final (que dependem direta ou indiretamente de
 * `user_score`).
 *
 * Espelha a fórmula client-side em work-form.tsx:
 *   user_score = round(Σ(post_i × w_i) / Σ(w_i), 1)
 * Considera apenas eixos com `post_i != null` no numerador E denominador.
 */
export async function applyPostReadingWeights(
  weights: Record<PostReadingScoreField, number>,
): Promise<{ recalculated: number; updatedManualScores: number }> {
  const supabase = createAdminClient()

  const selectColumns = ["id", "user_score", ...POST_READING_FIELDS].join(", ")
  const { data, error } = await supabase
    .from("works")
    .select(selectColumns)
    .eq("is_archived", false)
    .limit(2000)

  if (error) throw new Error(error.message)

  const updates: Array<{ id: string; user_score: number | null }> = []
  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any
    let scoreSum = 0
    let weightSum = 0
    let hasAny = false
    for (const field of POST_READING_FIELDS) {
      const raw = r[field]
      if (raw == null) continue
      const v = Number(raw)
      if (!Number.isFinite(v)) continue
      hasAny = true
      const w = weights[field] ?? 0
      scoreSum += v * w
      weightSum += w
    }
    if (!hasAny) continue
    const newScore = weightSum > 0 ? Math.round((scoreSum / weightSum) * 10) / 10 : null
    const currentScore = r.user_score == null ? null : Number(r.user_score)
    if (newScore !== currentScore) {
      updates.push({ id: r.id as string, user_score: newScore })
    }
  }

  if (updates.length > 0) {
    // Parallel individual updates — Supabase JS não tem bulk update por id.
    // Pra ~100-200 obras é instantâneo.
    const results = await Promise.all(
      updates.map((u) =>
        supabase.from("works").update({ user_score: u.user_score }).eq("id", u.id),
      ),
    )
    const firstError = results.find((r) => r.error)
    if (firstError?.error) throw new Error(firstError.error.message)
  }

  const recalc = await recalculateAll()
  return { recalculated: recalc.recalculated, updatedManualScores: updates.length }
}
