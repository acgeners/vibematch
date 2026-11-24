"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { ensureAdmin } from "@/server/queries/current-user"
import { CRITERION_SLUGS, type CategoryScoreMap, type CriterionSlug } from "@/types/domain"
import {
  inferScoreWeights,
  type CurrentWeight,
  type WeightInferenceInput,
  type WeightInferenceResult,
} from "@/lib/ml/weight-inference"
import { updateScoreWeights, type ScoreWeightUpdate } from "./settings"

/**
 * Calcula sugestões de `score_weights` a partir das obras avaliadas.
 * Não aplica nada — só retorna o diagnóstico pra exibir no UI.
 */
export async function suggestScoreWeights(): Promise<WeightInferenceResult> {
  // O apply já era gated; o suggest não era — e é ele que roda o Ridge sobre o
  // catálogo inteiro. Sem gate, é CPU grátis pra qualquer um.
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  const supabase = createAdminClient()

  // Paginada: `.limit(2000)` não passa de 1000 (o PostgREST corta ali sem erro). Hoje as obras com
  // nota cabem numa página; a régua não pode depender disso continuar verdade.
  const [works, weightsRes] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(
      () =>
        supabase
          .from("works_owner")
          .select(`id, user_score, category_scores(criterion_slug, score)`)
          .not("user_score", "is", null)
          .eq("is_archived", false),
      { orderBy: ["id"], label: "suggestScoreWeights" },
    ),
    supabase.from("score_weights").select("slug, weight").eq("is_active", true),
  ])

  if (weightsRes.error) throw new Error(weightsRes.error.message)

  const inputs: WeightInferenceInput[] = works.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any
    const categoryScores: CategoryScoreMap = {}
    for (const cs of r.category_scores ?? []) {
      categoryScores[cs.criterion_slug] = Number(cs.score)
    }
    return {
      workId: r.id as string,
      userScore: Number(r.user_score),
      categoryScores,
    }
  })

  const currentWeights: CurrentWeight[] = (weightsRes.data ?? [])
    .filter((w) => (CRITERION_SLUGS as readonly string[]).includes(w.slug))
    .map((w) => ({
      slug: w.slug as CriterionSlug,
      weight: Number(w.weight),
    }))

  return inferScoreWeights(inputs, currentWeights)
}

export interface WeightSuggestionApply {
  slug: CriterionSlug
  weight: number
}

/**
 * Aplica um subconjunto das sugestões. Reusa `updateScoreWeights` —
 * bumpa a versão da fórmula e dispara `recalculateAll()`.
 *
 * Thresholds não são tocados aqui (calibrar threshold é problema separado).
 * `updateScoreWeights` os mantém quando `threshold` é omitido (null no payload).
 */
export async function applyWeightSuggestions(
  applies: WeightSuggestionApply[],
): Promise<{ recalculated: number; appliedCount: number }> {
  // Reescreve score_weights global + recalcula → gate de admin (stopgap).
  // Sinaliza erro via throw; o caller (painel) já trata em try/catch → toast.
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  if (applies.length === 0) {
    return { recalculated: 0, appliedCount: 0 }
  }

  // Carrega thresholds atuais pra preservar (não estamos sugerindo threshold aqui)
  const supabase = createAdminClient()
  const { data: existing, error } = await supabase
    .from("score_weights")
    .select("slug, threshold")
    .in(
      "slug",
      applies.map((a) => a.slug),
    )
  if (error) throw new Error(error.message)

  const thresholdBySlug = new Map<string, number | null>(
    (existing ?? []).map((r) => [r.slug as string, r.threshold as number | null]),
  )

  const updates: ScoreWeightUpdate[] = applies.map((a) => ({
    slug: a.slug,
    weight: a.weight,
    threshold: thresholdBySlug.get(a.slug) ?? null,
  }))

  // updateScoreWeights tem o próprio gate de admin, então pode devolver {error}.
  // Aqui é inalcançável (esta action já passou pelo mesmo gate), mas o caller
  // espera `recalculated` — propaga como throw, que o painel já catcheia.
  const result = await updateScoreWeights(updates)
  if ("error" in result) throw new Error(result.error)
  return {
    recalculated: result.recalculated,
    appliedCount: applies.length,
  }
}
