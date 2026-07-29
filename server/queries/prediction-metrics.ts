import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  computeProspectiveSummary,
  computeErrorByScoreBand,
  computeErrorByFormula,
  computeErrorByPeriod,
  computeBaselines,
  computeBaselinesOnCommonSubset,
  computeSnapshotStats,
  medianResolutionLatencyMs,
  selectPrimaryPredictionPerWork,
  selectPrimaryPredictionPerWorkAndFormula,
  type ResolvedSnapshot,
  type ProspectiveSummary,
  type BucketErrorEntry,
  type BaselineRow,
  type CommonSubsetBaselines,
  type SnapshotStats,
} from "@/lib/metrics/prediction-metrics"
import { computeRankingMetrics, type RankedPair, type RankingMetrics } from "@/lib/metrics/ranking-metrics"
import {
  classifyCollectionError,
  warnPredictionCollectionOnce,
  type CollectionStatus,
} from "@/lib/server/predictions/collection-status"

/** Mínimo de obras resolvidas num grupo (ranking_snapshot) pra métricas de ordenação. */
export const MIN_RANKING_GROUP_SIZE = 5

export interface ModelMetricsDashboard {
  status: CollectionStatus
  stats: SnapshotStats
  /** Previsões resolvidas em FALLBACK (stub) — excluídas das métricas. */
  stubResolved: number
  /** Tempo mediano entre previsão e avaliação (ms), no conjunto principal por obra. */
  medianTimeToEvalMs: number | null
  lastResolvedAt: string | null
  cvMae: number | null
  /** Métrica PRINCIPAL: 1 previsão por obra (sem pseudorreplicação). */
  primary: ProspectiveSummary
  primaryBaselines: BaselineRow[]
  primaryCommonSubset: CommonSubsetBaselines
  byScoreBand: BucketErrorEntry[]
  byFormula: BucketErrorEntry[]
  byPeriod: BucketErrorEntry[]
  /** Métrica DIAGNÓSTICA: todos os snapshots resolvidos (não-superseded). */
  perSnapshot: ProspectiveSummary
  /** Snapshots resolvidos por obra (média) — frequência de re-previsão. */
  avgSnapshotsPerWork: number | null
  /** Ordenação por ranking_snapshot_id. */
  ranking: { totalGroups: number; usableGroups: number; aggregate: RankingMetrics | null }
}

interface RawSnapshotRow {
  work_id: string
  captured_at: string
  predicted_score: number | null
  predicted_is_stub: boolean
  calc_score: number | null
  decision_score: number | null
  actual_user_score: number | null
  formula_version: string
  resolved_at: string | null
  training_sample_size: number | null
  ranking_snapshot_id: string | null
  superseded: boolean
}

function toResolved(row: RawSnapshotRow): ResolvedSnapshot {
  return {
    workId: row.work_id,
    capturedAt: row.captured_at,
    resolvedAt: row.resolved_at as string,
    superseded: row.superseded,
    predictedIsStub: row.predicted_is_stub,
    actual: Number(row.actual_user_score),
    predictedScore: row.predicted_score == null ? null : Number(row.predicted_score),
    calcScore: row.calc_score == null ? null : Number(row.calc_score),
    decisionScore: row.decision_score == null ? null : Number(row.decision_score),
    formulaVersion: row.formula_version,
    trainingSampleSize: row.training_sample_size == null ? null : Number(row.training_sample_size),
  }
}

/** Média de cada métrica de ranking entre os grupos com amostra suficiente. */
function aggregateRankingMetrics(groups: RankingMetrics[]): RankingMetrics | null {
  if (groups.length === 0) return null
  const avg = (sel: (m: RankingMetrics) => number | null): number | null => {
    const vals = groups.map(sel).filter((v): v is number => v != null && Number.isFinite(v))
    return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length
  }
  return {
    count: groups.reduce((a, g) => a + g.count, 0),
    spearman: avg((m) => m.spearman),
    kendallTau: avg((m) => m.kendallTau),
    pairwiseAccuracy: avg((m) => m.pairwiseAccuracy),
    ndcgAt5: avg((m) => m.ndcgAt5),
    ndcgAt10: avg((m) => m.ndcgAt10),
    precisionAt5: avg((m) => m.precisionAt5),
    precisionAt10: avg((m) => m.precisionAt10),
    regretAt5: avg((m) => m.regretAt5),
    regretAt10: avg((m) => m.regretAt10),
  }
}

const EMPTY_PROSPECTIVE: ProspectiveSummary = {
  count: 0,
  mae: null,
  rmse: null,
  meanSignedError: null,
  medianAbsError: null,
}

const EMPTY_STATS: SnapshotStats = {
  recorded: 0,
  resolved: 0,
  pending: 0,
  superseded: 0,
  resolutionRate: null,
  uniqueWorksPredicted: 0,
  uniqueWorksEvaluated: 0,
  resolutionRateByWork: null,
  rankingsRecorded: 0,
}

function emptyDashboard(status: CollectionStatus, cvMae: number | null): ModelMetricsDashboard {
  return {
    status,
    stats: EMPTY_STATS,
    stubResolved: 0,
    medianTimeToEvalMs: null,
    lastResolvedAt: null,
    cvMae,
    primary: EMPTY_PROSPECTIVE,
    primaryBaselines: [],
    primaryCommonSubset: { subsetCount: 0, rows: [] },
    byScoreBand: [],
    byFormula: [],
    byPeriod: [],
    perSnapshot: EMPTY_PROSPECTIVE,
    avgSnapshotsPerWork: null,
    ranking: { totalGroups: 0, usableGroups: 0, aggregate: null },
  }
}

/**
 * Monta o painel de métricas prospectivas a partir dos prediction_snapshots.
 * Diferencia o status da coleta (P1.4): tabela ausente, erro de conexão, erro
 * inesperado, sem dados, ou ativa. NÃO transforma todo erro em "indisponível"
 * sem diagnóstico.
 *
 * Métrica PRINCIPAL = 1 previsão por obra (sem pseudorreplicação); DIAGNÓSTICA =
 * todos os snapshots; RANKING = por ranking_snapshot_id.
 */
export async function getModelMetricsDashboard(): Promise<ModelMetricsDashboard> {
  const supabase = createAdminClient()

  // CV-MAE honesta (mesma da headline de /settings) pra comparar com a prospectiva.
  const configRes = await supabase
    .from("formula_config")
    .select("cv_mae_expected_stage1")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const cvMae =
    configRes.data && configRes.data.cv_mae_expected_stage1 != null
      ? Number(configRes.data.cv_mae_expected_stage1)
      : null

  // `discarded_at is null` (migration 168): fora as medições cujo rótulo o usuário APAGOU. Sem
  // gabarito não há acerto nem erro — medir contra uma nota retirada fabrica número. Filtrado
  // aqui, na única leitura, pra que TODA métrica derivada saia limpa por construção.
  const { data, error } = await supabase
    .from("prediction_snapshots")
    .select(
      "work_id, captured_at, predicted_score, predicted_is_stub, calc_score, decision_score, actual_user_score, formula_version, resolved_at, training_sample_size, ranking_snapshot_id, superseded",
    )
    .is("discarded_at", null)
    .limit(20000)

  if (error) {
    const status = classifyCollectionError(error)
    warnPredictionCollectionOnce(status, error.message)
    return emptyDashboard(status, cvMae)
  }

  const rows = (data ?? []) as unknown as RawSnapshotRow[]
  if (rows.length === 0) return emptyDashboard("no_data", cvMae)

  const stats = computeSnapshotStats(
    rows.map((r) => ({
      workId: r.work_id,
      rankingSnapshotId: r.ranking_snapshot_id,
      resolvedAt: r.resolved_at,
      superseded: r.superseded,
    })),
  )

  const lastResolvedAt = rows
    .filter((r) => r.resolved_at != null)
    .reduce<string | null>((acc, r) => {
      const ts = r.resolved_at as string
      return acc == null || ts > acc ? ts : acc
    }, null)

  // Conjunto de RESOLVIDOS (com nota). As funções de seleção excluem superseded
  // E stub internamente; o per-snapshot filtra ambos aqui.
  const allResolved = rows.filter((r) => r.resolved_at != null && r.actual_user_score != null).map(toResolved)
  const stubResolved = allResolved.filter((s) => !s.superseded && s.predictedIsStub).length
  // Diagnóstica "por snapshot": válidos (sem superseded e sem stub).
  const perSnapshotSet = allResolved.filter((s) => !s.superseded && !s.predictedIsStub)
  // Principal global: 1 por obra (stub/superseded já filtrados na seleção).
  const primarySet = selectPrimaryPredictionPerWork(allResolved)
  // Por fórmula: 1 por obra × fórmula (comparação pareada no mesmo conjunto).
  const perFormulaSet = selectPrimaryPredictionPerWorkAndFormula(allResolved)

  const uniqueEvaluatedWorks = new Set(perSnapshotSet.map((s) => s.workId)).size
  const avgSnapshotsPerWork = uniqueEvaluatedWorks > 0 ? perSnapshotSet.length / uniqueEvaluatedWorks : null

  // Métricas de ordenação por grupo (ranking_snapshot_id) com amostra suficiente.
  // Exclui stub e superseded (predicted de stub é a média → inútil pra ordenar).
  const byGroup = new Map<string, RankedPair[]>()
  for (const r of rows) {
    if (
      r.ranking_snapshot_id == null ||
      r.resolved_at == null ||
      r.superseded ||
      r.predicted_is_stub ||
      r.actual_user_score == null ||
      r.predicted_score == null
    ) {
      continue
    }
    const arr = byGroup.get(r.ranking_snapshot_id) ?? []
    arr.push({ predicted: Number(r.predicted_score), actual: Number(r.actual_user_score) })
    byGroup.set(r.ranking_snapshot_id, arr)
  }
  const usable = [...byGroup.values()].filter((g) => g.length >= MIN_RANKING_GROUP_SIZE)
  const rankingAggregate = aggregateRankingMetrics(usable.map((g) => computeRankingMetrics(g)))

  return {
    status: "active",
    stats,
    stubResolved,
    medianTimeToEvalMs: medianResolutionLatencyMs(primarySet),
    lastResolvedAt,
    cvMae,
    primary: computeProspectiveSummary(primarySet),
    primaryBaselines: computeBaselines(primarySet),
    primaryCommonSubset: computeBaselinesOnCommonSubset(primarySet),
    byScoreBand: computeErrorByScoreBand(primarySet),
    byFormula: computeErrorByFormula(perFormulaSet),
    byPeriod: computeErrorByPeriod(primarySet, "month"),
    perSnapshot: computeProspectiveSummary(perSnapshotSet),
    avgSnapshotsPerWork,
    ranking: { totalGroups: byGroup.size, usableGroups: usable.length, aggregate: rankingAggregate },
  }
}
