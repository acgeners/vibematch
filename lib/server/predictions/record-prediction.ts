import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import { getTierBandWidth } from "@/server/queries/tier-band-width"
import { predictionSnapshotSchema, buildDedupKey } from "./prediction-context"
import type { PredictionContext, PredictionSnapshotInput } from "./prediction-context"
import { classifyCollectionError, warnPredictionCollectionOnce } from "./collection-status"

/**
 * Camada de REGISTRO de snapshots prospectivos (prediction_snapshots / P1).
 *
 * Best-effort por construção: NUNCA lança pro caller (não pode quebrar a
 * recomendação nem o save). Se a migration 105 não foi aplicada, o insert falha
 * e vira no-op silencioso (logado). Imutável: o insert usa o dedup_key como
 * conflito com `ignoreDuplicates` — nunca sobrescreve um snapshot existente.
 */

type SnapshotRow = {
  user_id: string
  work_id: string
  predicted_score: number | null
  calc_score: number | null
  personal_fit: number | null
  alignment_score: number | null
  decision_score: number | null
  tier: number | null
  tier_band_width: number | null
  predicted_is_stub: boolean
  formula_version: string
  model_version: string | null
  prompt_version: string | null
  training_sample_size: number | null
  cv_mae: number | null
  mood_key: string | null
  prediction_context: PredictionContext
  ranking_snapshot_id: string | null
  dedup_key: string
  captured_at: string
}

function toRow(input: PredictionSnapshotInput, capturedAt: string): SnapshotRow {
  return {
    user_id: input.userId,
    work_id: input.workId,
    predicted_score: input.predictedScore,
    calc_score: input.calcScore,
    personal_fit: input.personalFit,
    alignment_score: input.alignmentScore,
    decision_score: input.decisionScore,
    tier: input.tier,
    tier_band_width: input.tierBandWidth,
    predicted_is_stub: input.predictedIsStub,
    formula_version: input.formulaVersion,
    model_version: input.modelVersion,
    prompt_version: input.promptVersion,
    training_sample_size: input.trainingSampleSize,
    cv_mae: input.cvMae,
    mood_key: input.moodKey,
    prediction_context: input.predictionContext,
    ranking_snapshot_id: input.rankingSnapshotId,
    dedup_key: buildDedupKey({
      userId: input.userId,
      workId: input.workId,
      formulaVersion: input.formulaVersion,
      predictionContext: input.predictionContext,
      moodKey: input.moodKey,
      capturedAt,
      rankingSnapshotId: input.rankingSnapshotId,
    }),
    captured_at: capturedAt,
  }
}

/**
 * Insere uma lista de snapshots já validados. Dedup por `dedup_key`
 * (ignoreDuplicates) → re-registrar o mesmo contexto no mesmo dia é no-op.
 * Retorna a quantidade enviada pro insert (após validação), 0 em falha.
 */
export async function recordPredictionSnapshots(
  inputs: PredictionSnapshotInput[],
): Promise<number> {
  if (inputs.length === 0) return 0
  try {
    const capturedAt = new Date().toISOString()
    const rows: SnapshotRow[] = []
    for (const raw of inputs) {
      const parsed = predictionSnapshotSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn("[recordPredictionSnapshots] input inválido, ignorado:", parsed.error.issues[0]?.message)
        continue
      }
      rows.push(toRow(parsed.data, capturedAt))
    }
    if (rows.length === 0) return 0

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("prediction_snapshots")
      .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true })
    if (error) {
      // Warning estruturado UMA vez por processo (não a cada recomendação).
      warnPredictionCollectionOnce(classifyCollectionError(error), error.message)
      return 0
    }
    return rows.length
  } catch (err) {
    console.warn(
      "[recordPredictionSnapshots] falhou (best-effort, não bloqueia):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}

/**
 * Registra os snapshots prospectivos de UMA recomendação/ranking. Lê os scores
 * pré-rótulo já persistidos em calculated_scores e filtra SÓ as obras ainda SEM
 * user_score (genuinamente prospectivas / leak-free). Agrupa todas sob o mesmo
 * `rankingSnapshotId` (a run da recomendação) pra permitir métricas de ordenação.
 *
 * Best-effort. Chamado de runRecommendationAction após persistir a run.
 */
export async function recordRecommendationSnapshots(args: {
  rankingSnapshotId: string
  workIds: string[]
  modelVersion?: string | null
  promptVersion?: string | null
  moodKey?: string | null
}): Promise<number> {
  if (args.workIds.length === 0) return 0
  try {
    const supabase = createAdminClient()
    const [userId, bandWidth, configRes, worksRes] = await Promise.all([
      getCurrentUserId(supabase),
      getTierBandWidth(),
      supabase
        .from("formula_config")
        .select("formula_version, cv_mae_expected_stage1, expected_stage2_train_size")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("works")
        .select(
          "id, user_score, calculated_scores(expected_score, calc_score, personal_fit, alignment_score, alignment_payload, expected_is_stub)",
        )
        .in("id", args.workIds),
    ])

    const config = configRes.data as {
      formula_version: string | null
      cv_mae_expected_stage1: number | null
      expected_stage2_train_size: number | null
    } | null
    const formulaVersion = config?.formula_version
    if (!formulaVersion) {
      console.warn("[recordRecommendationSnapshots] sem formula_version — abortado")
      return 0
    }

    type WorkRow = {
      id: string
      user_score: number | null
      calculated_scores: {
        expected_score: number | null
        calc_score: number | null
        personal_fit: number | null
        alignment_score: number | null
        alignment_payload: { confidence?: number } | null
        expected_is_stub: boolean | null
      } | null
    }
    const rawWorks = (worksRes.data ?? []) as unknown as WorkRow[]
    // SÓ obras prospectivas: sem nota ainda (o snapshot precisa ser pré-rótulo).
    const prospective = rawWorks.filter((w) => w.user_score == null)
    if (prospective.length === 0) return 0

    // Tiers calculados sobre o expected_score do grupo prospectivo, com a banda
    // configurada (a mesma usada no ranking).
    const tiered = buildRankingTiers(
      prospective,
      (w) => w.calculated_scores?.expected_score ?? null,
      bandWidth,
    )
    const tierByWork = new Map<string, number>()
    for (const t of tiered) tierByWork.set(t.item.id, t.tier)

    const moodKey = args.moodKey?.trim() || null
    const inputs: PredictionSnapshotInput[] = prospective.map((w) => {
      const cs = w.calculated_scores
      const expected = cs?.expected_score ?? null
      const decision = computeDecisionScore({
        expected,
        alignment: cs?.alignment_score ?? null,
        confidence: cs?.alignment_payload?.confidence ?? null,
      })
      return {
        workId: w.id,
        userId,
        predictedScore: expected,
        calcScore: cs?.calc_score ?? null,
        personalFit: cs?.personal_fit ?? null,
        alignmentScore: cs?.alignment_score ?? null,
        decisionScore: decision,
        tier: tierByWork.get(w.id) ?? null,
        tierBandWidth: bandWidth,
        predictedIsStub: cs?.expected_is_stub ?? true,
        formulaVersion,
        modelVersion: args.modelVersion ?? null,
        promptVersion: args.promptVersion ?? null,
        trainingSampleSize: config?.expected_stage2_train_size ?? null,
        cvMae: config?.cv_mae_expected_stage1 ?? null,
        moodKey,
        predictionContext: "recommendation",
        rankingSnapshotId: args.rankingSnapshotId,
      }
    })

    return await recordPredictionSnapshots(inputs)
  } catch (err) {
    console.warn(
      "[recordRecommendationSnapshots] falhou (best-effort, não bloqueia a recomendação):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
