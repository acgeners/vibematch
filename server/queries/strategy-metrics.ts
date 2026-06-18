import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  computeStrategyComparison,
  type StrategyResultRecord,
  type StrategyComparisonReport,
} from "@/lib/metrics/strategy-comparison"
import {
  classifyCollectionError,
  warnPredictionCollectionOnce,
  type CollectionStatus,
} from "@/lib/server/predictions/collection-status"

export interface StrategyComparisonDashboard {
  status: CollectionStatus
  report: StrategyComparisonReport
}

const EMPTY_REPORT: StrategyComparisonReport = {
  strategies: [],
  pairwise: [],
  totalRuns: 0,
  totalResolvedSnapshots: 0,
}

interface RawRow {
  prediction_snapshot_id: string
  ranking_snapshot_id: string
  strategy_key: string
  strategy_version: string
  rank_position: number | null
  strategy_score: number | null
  eligible: boolean
  is_displayed_strategy: boolean
  prediction_snapshots:
    | {
        actual_user_score: number | null
        resolved_at: string | null
        superseded: boolean
        predicted_is_stub: boolean
      }
    | Array<{
        actual_user_score: number | null
        resolved_at: string | null
        superseded: boolean
        predicted_is_stub: boolean
      }>
    | null
}

function toRecord(row: RawRow): StrategyResultRecord {
  const psRaw = row.prediction_snapshots
  const ps = Array.isArray(psRaw) ? psRaw[0] : psRaw
  return {
    predictionSnapshotId: row.prediction_snapshot_id,
    rankingSnapshotId: row.ranking_snapshot_id,
    strategyKey: row.strategy_key,
    strategyVersion: row.strategy_version,
    rankPosition: row.rank_position == null ? null : Number(row.rank_position),
    strategyScore: row.strategy_score == null ? null : Number(row.strategy_score),
    eligible: row.eligible,
    isDisplayedStrategy: row.is_displayed_strategy,
    actual: ps?.actual_user_score == null ? null : Number(ps.actual_user_score),
    resolvedAt: ps?.resolved_at ?? null,
    superseded: ps?.superseded ?? false,
    predictedIsStub: ps?.predicted_is_stub ?? false,
  }
}

/**
 * Monta o painel de comparação de estratégias (shadow ranking). Diferencia o
 * status da coleta (migration 106 ausente × erro × ativa). As métricas saem do
 * vazio só quando houver runs com obras resolvidas suficientes.
 */
export async function getStrategyComparisonDashboard(): Promise<StrategyComparisonDashboard> {
  const supabase = createAdminClient()

  // Estratégias (⋈ resolução) + contagem de prediction_snapshots por run (fonte
  // ANTERIOR à captura — base do "run completo", não as linhas da estratégia).
  const [stratRes, snapRes] = await Promise.all([
    supabase
      .from("ranking_strategy_snapshots")
      .select(
        "prediction_snapshot_id, ranking_snapshot_id, strategy_key, strategy_version, rank_position, strategy_score, eligible, is_displayed_strategy, prediction_snapshots(actual_user_score, resolved_at, superseded, predicted_is_stub)",
      )
      .limit(50000),
    supabase
      .from("prediction_snapshots")
      .select("ranking_snapshot_id")
      .not("ranking_snapshot_id", "is", null)
      .limit(50000),
  ])

  if (stratRes.error) {
    const status = classifyCollectionError(stratRes.error)
    warnPredictionCollectionOnce(status, stratRes.error.message)
    return { status, report: EMPTY_REPORT }
  }

  const rows = (stratRes.data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return { status: "no_data", report: EMPTY_REPORT }

  // Nº de obras prospectivas (snapshots) por run = total ESPERADO de linhas por
  // estratégia. Se a leitura falhar, mapa vazio → runs ficam não-confirmados
  // como completos (conservador), nunca falsamente completos.
  const expectedByRun = new Map<string, number>()
  if (!snapRes.error) {
    for (const r of (snapRes.data ?? []) as Array<{ ranking_snapshot_id: string | null }>) {
      if (r.ranking_snapshot_id == null) continue
      expectedByRun.set(r.ranking_snapshot_id, (expectedByRun.get(r.ranking_snapshot_id) ?? 0) + 1)
    }
  } else {
    warnPredictionCollectionOnce(classifyCollectionError(snapRes.error), snapRes.error.message)
  }

  const records = rows.map(toRecord)
  return { status: "active", report: computeStrategyComparison(records, expectedByRun) }
}
