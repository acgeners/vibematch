import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildShadowRankings } from "@/lib/ranking/strategies/build-shadow-rankings"
import type { RankingCandidate } from "@/lib/ranking/strategies/types"
import { classifyCollectionError, warnPredictionCollectionOnce } from "./collection-status"

/**
 * Persistência do SHADOW RANKING (ranking_strategy_snapshots / migration 106).
 *
 * Best-effort por construção: NUNCA lança pro caller (não pode quebrar a
 * recomendação). Se a migration 106 não foi aplicada, o insert falha e vira
 * no-op silencioso (warn-once). Idempotente: o upsert usa
 * (prediction_snapshot_id, strategy_key, strategy_version) como conflito com
 * `ignoreDuplicates` → re-registrar o mesmo run/estratégia é no-op (imutável).
 *
 * NÃO faz chamadas de IA nem recalcula sinais — só reordena os sinais JÁ
 * presentes nos candidatos daquela recomendação.
 */

interface ShadowRow {
  prediction_snapshot_id: string
  ranking_snapshot_id: string
  strategy_key: string
  strategy_version: string
  rank_position: number | null
  tier: number | null
  strategy_score: number | null
  eligible: boolean
  exclusion_reason: string | null
  is_displayed_strategy: boolean
}

/**
 * Calcula todas as estratégias sobre `candidates` e persiste as linhas em
 * ranking_strategy_snapshots. Retorna a quantidade de linhas enviadas (0 em
 * falha ou lista vazia). `moodActive` controla se mood_within_tier é gerada.
 */
export async function persistShadowRankings(args: {
  rankingSnapshotId: string
  candidates: readonly RankingCandidate[]
  moodActive: boolean
}): Promise<number> {
  if (args.candidates.length === 0) return 0
  try {
    const strategies = buildShadowRankings({
      candidates: args.candidates,
      moodActive: args.moodActive,
    })

    const rows: ShadowRow[] = []
    for (const s of strategies) {
      for (const item of s.items) {
        rows.push({
          prediction_snapshot_id: item.predictionSnapshotId,
          ranking_snapshot_id: args.rankingSnapshotId,
          strategy_key: s.key,
          strategy_version: s.version,
          rank_position: item.rankPosition,
          tier: item.tier,
          strategy_score: item.strategyScore,
          eligible: item.eligible,
          exclusion_reason: item.exclusionReason,
          is_displayed_strategy: s.isDisplayedStrategy,
        })
      }
    }
    if (rows.length === 0) return 0

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("ranking_strategy_snapshots")
      .upsert(rows, {
        onConflict: "prediction_snapshot_id,strategy_key,strategy_version",
        ignoreDuplicates: true,
      })
    if (error) {
      warnPredictionCollectionOnce(classifyCollectionError(error), error.message)
      return 0
    }
    return rows.length
  } catch (err) {
    console.warn(
      "[persistShadowRankings] falhou (best-effort, não bloqueia a recomendação):",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
