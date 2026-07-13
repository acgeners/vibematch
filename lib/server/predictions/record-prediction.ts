import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { computeDecisionScore } from "@/lib/calculations/decision"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import { getTierBandWidth } from "@/server/queries/tier-band-width"
import {
  predictionSnapshotSchema,
  buildDedupKey,
  rankingSnapshotIdFor,
  getPredictionDateBucket,
} from "./prediction-context"
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
  rank_position: number | null
  filters_key: string | null
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
    rank_position: input.rankPosition ?? null,
    filters_key: input.filtersKey ?? null,
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
        .from("works_owner")
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

/**
 * Teto de obras por snapshot de ranking. Só o topo importa pra decisão/métricas;
 * evita gravar centenas de linhas quando o usuário desliga o topN. Truncagem é
 * LOGADA (nunca silenciosa).
 */
const MAX_RANKING_SNAPSHOT_WORKS = 200
/** Teto do fetch de scores (o rank importa mais no topo). Chunk do `.in()` = 150. */
const RANKING_SNAPSHOT_FETCH_LIMIT = 400

/**
 * Registra os snapshots prospectivos de UMA visualização do /ranking FREE
 * (contexto `ranking_snapshot`), a partir da ordem EXIBIDA. Análogo a
 * `recordRecommendationSnapshots`, mas:
 *   - o `ranking_snapshot_id` é DETERMINÍSTICO por (usuário, dia, fórmula,
 *     filtros, mood) → re-render no mesmo dia com os mesmos filtros é no-op
 *     (dedup), sem explosão de escrita;
 *   - grava `rank_position` (posição 1-based EXIBIDA, migration 135);
 *   - filtra só obras SEM `user_score` (prospectivas / leak-free).
 *
 * Best-effort: NUNCA lança pro caller (é chamado via `after()` no render do
 * /ranking). No-op silencioso se a migration 105/135 não estiver aplicada.
 *
 * @param orderedWorkIds ids na ORDEM exibida (índice 0 = rank 1).
 * @param filtersKey descritor estável do conjunto de filtros aplicado.
 */
export async function recordRankingSnapshots(args: {
  orderedWorkIds: string[]
  filtersKey: string
  moodKey?: string | null
}): Promise<number> {
  if (args.orderedWorkIds.length === 0) return 0
  try {
    const supabase = createAdminClient()
    const [userId, bandWidth, configRes] = await Promise.all([
      getCurrentUserId(supabase),
      getTierBandWidth(),
      supabase
        .from("formula_config")
        .select("formula_version, cv_mae_expected_stage1, expected_stage2_train_size")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const config = configRes.data as {
      formula_version: string | null
      cv_mae_expected_stage1: number | null
      expected_stage2_train_size: number | null
    } | null
    const formulaVersion = config?.formula_version
    if (!formulaVersion) {
      console.warn("[recordRankingSnapshots] sem formula_version — abortado")
      return 0
    }

    // Rank 1-based na ordem EXIBIDA (antes de qualquer filtro de prospecção).
    const rankByWork = new Map<string, number>()
    args.orderedWorkIds.forEach((id, i) => rankByWork.set(id, i + 1))

    // Só o topo é relevante pra decisão; busca um prefixo limitado (log se cortou).
    const head = args.orderedWorkIds.slice(0, RANKING_SNAPSHOT_FETCH_LIMIT)
    if (args.orderedWorkIds.length > head.length) {
      console.warn(
        `[recordRankingSnapshots] lista ${args.orderedWorkIds.length} obras — considerando só o top ${head.length} pro snapshot.`,
      )
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
    const byId = new Map<string, WorkRow>()
    for (let i = 0; i < head.length; i += 150) {
      const chunk = head.slice(i, i + 150)
      const { data, error } = await supabase
        .from("works_owner")
        .select(
          "id, user_score, calculated_scores(expected_score, calc_score, personal_fit, alignment_score, alignment_payload, expected_is_stub)",
        )
        .in("id", chunk)
      if (error) {
        console.warn("[recordRankingSnapshots] leitura de scores falhou:", error.message)
        return 0
      }
      for (const w of (data ?? []) as unknown as WorkRow[]) byId.set(w.id, w)
    }

    // Prospectivas (sem nota) preservando a ordem exibida; cap com log.
    const prospective = head.filter((id) => byId.get(id)?.user_score == null)
    if (prospective.length === 0) return 0
    const capped = prospective.slice(0, MAX_RANKING_SNAPSHOT_WORKS)
    if (capped.length < prospective.length) {
      console.warn(
        `[recordRankingSnapshots] ${prospective.length} obras prospectivas — capadas em ${capped.length} (MAX_RANKING_SNAPSHOT_WORKS).`,
      )
    }

    const moodKey = args.moodKey?.trim() || null
    const rankingSnapshotId = rankingSnapshotIdFor({
      userId,
      dayBucket: getPredictionDateBucket(new Date()),
      formulaVersion,
      filtersKey: args.filtersKey,
      moodKey,
    })

    // Tiers sobre o expected_score do grupo prospectivo, com a banda configurada.
    const tiered = buildRankingTiers(
      capped.map((id) => byId.get(id)!),
      (w) => w.calculated_scores?.expected_score ?? null,
      bandWidth,
    )
    const tierByWork = new Map<string, number>()
    tiered.forEach((t) => tierByWork.set(t.item.id, t.tier))

    const inputs: PredictionSnapshotInput[] = capped.map((id) => {
      const cs = byId.get(id)!.calculated_scores
      const expected = cs?.expected_score ?? null
      const decision = computeDecisionScore({
        expected,
        alignment: cs?.alignment_score ?? null,
        confidence: cs?.alignment_payload?.confidence ?? null,
      })
      return {
        workId: id,
        userId,
        predictedScore: expected,
        calcScore: cs?.calc_score ?? null,
        personalFit: cs?.personal_fit ?? null,
        alignmentScore: cs?.alignment_score ?? null,
        decisionScore: decision,
        tier: tierByWork.get(id) ?? null,
        tierBandWidth: bandWidth,
        predictedIsStub: cs?.expected_is_stub ?? true,
        formulaVersion,
        modelVersion: null,
        promptVersion: null,
        trainingSampleSize: config?.expected_stage2_train_size ?? null,
        cvMae: config?.cv_mae_expected_stage1 ?? null,
        moodKey,
        predictionContext: "ranking_snapshot",
        rankingSnapshotId,
        rankPosition: rankByWork.get(id) ?? null,
        // Filtros LEGÍVEIS da run (migration 136) — o MESMO filtersKey já usado
        // no ranking_snapshot_id/dedup. Puramente descritivo; não muda o dedup.
        filtersKey: args.filtersKey,
      }
    })

    return await recordPredictionSnapshots(inputs)
  } catch (err) {
    console.warn(
      "[recordRankingSnapshots] falhou (best-effort, não bloqueia o /ranking):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
