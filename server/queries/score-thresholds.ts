import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"

export interface ScoreColorThresholds {
  p_top: number
  p_high: number
  p_mid: number
  p_low: number
}

const MIN_POOL_SIZE = 5

/**
 * Interpolação linear (tipo R-7 / numpy default). `sortedAsc` precisa estar
 * ordenado em ordem crescente. `p` em [0, 100].
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN
  if (sortedAsc.length === 1) return sortedAsc[0]
  const rank = ((p / 100) * (sortedAsc.length - 1))
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sortedAsc[lo]
  const frac = rank - lo
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac
}

/**
 * Calcula 4 cutoffs de nota agregada baseados em percentis configurados
 * em `formula_config` aplicados à distribuição de `final_score` das obras
 * não-arquivadas. Devolve `null` quando o pool é pequeno demais — nesse
 * caso o ScoreBadge cai pros thresholds fixos atuais.
 *
 * Cache com tag `score-color-thresholds`. Invalidar via revalidateTag
 * quando obras forem criadas/editadas/arquivadas ou quando os percentis
 * forem alterados em /preferences.
 */
export const getScoreColorThresholds = unstable_cache(
  async (): Promise<ScoreColorThresholds | null> => {
    const supabase = createAdminClient()

    const [{ data: configRow }, { data: workRows }] = await Promise.all([
      supabase
        .from("formula_config")
        .select("score_color_pct_top, score_color_pct_high, score_color_pct_mid, score_color_pct_low")
        .limit(1)
        .single(),
      supabase
        .from("works")
        .select("calculated_scores(final_score)")
        .eq("is_archived", false),
    ])

    if (!configRow) return null

    const scores = ((workRows ?? []) as Array<{
      calculated_scores: { final_score: number | null } | { final_score: number | null }[] | null
    }>)
      .map((row) => {
        const cs = Array.isArray(row.calculated_scores) ? row.calculated_scores[0] : row.calculated_scores
        return cs?.final_score == null ? Number.NaN : Number(cs.final_score)
      })
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b)

    if (scores.length < MIN_POOL_SIZE) return null

    return {
      p_top: percentile(scores, Number(configRow.score_color_pct_top)),
      p_high: percentile(scores, Number(configRow.score_color_pct_high)),
      p_mid: percentile(scores, Number(configRow.score_color_pct_mid)),
      p_low: percentile(scores, Number(configRow.score_color_pct_low)),
    }
  },
  ["score-color-thresholds-v1"],
  { revalidate: 300, tags: ["score-color-thresholds"] }
)
