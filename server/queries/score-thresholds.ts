import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS } from "@/types/domain"
import type { ColumnThresholds, ScoreColorThresholds } from "@/components/ui/score-badge"

export type { ColumnThresholds, ScoreColorThresholds }

type PctCfg = { top: number; high: number; mid: number; low: number }

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

// Arredondamento half-away pra 1 casa decimal — casa com `score.toFixed(1)`
// do ScoreBadge, garantindo que valores com mesmo display recebam mesma cor.
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function computeColumn(
  scores: number[],
  cfg: { top: number; high: number; mid: number; low: number },
): ScoreColorThresholds | null {
  if (scores.length < MIN_POOL_SIZE) return null
  return {
    p_top: round1(percentile(scores, cfg.top)),
    p_high: round1(percentile(scores, cfg.high)),
    p_mid: round1(percentile(scores, cfg.mid)),
    p_low: round1(percentile(scores, cfg.low)),
  }
}

/**
 * Calcula 4 cutoffs de cor para CADA coluna (N.Final, N.IA, N.Pr) baseados
 * nos percentis configurados em `formula_config`, aplicados à distribuição
 * de cada coluna independentemente. Devolve `null` se qualquer coluna tem
 * pool < MIN_POOL_SIZE — nesse caso o ScoreBadge cai pros thresholds fixos.
 *
 * Cache com tag `score-color-thresholds`. Invalidar via revalidateTag
 * quando obras forem criadas/editadas/arquivadas ou quando os percentis
 * forem alterados em /conta/preferencias.
 */
export const getScoreColorThresholds = unstable_cache(
  async (): Promise<ColumnThresholds | null> => {
    const supabase = createAdminClient()

    // select("*") em formula_config pra não quebrar quando a coluna de override
    // por critério (criterion_color_pcts) ainda não existe (pré-migration).
    const [{ data: configRow }, { data: workRows }] = await Promise.all([
      supabase.from("formula_config").select("*").limit(1).single(),
      supabase
        .from("works")
        .select("calculated_scores(final_score, calc_score, predicted_score), category_scores(criterion_slug, score)")
        .eq("is_archived", false),
    ])

    if (!configRow) return null

    const cfg: PctCfg = {
      top: Number(configRow.score_color_pct_top),
      high: Number(configRow.score_color_pct_high),
      mid: Number(configRow.score_color_pct_mid),
      low: Number(configRow.score_color_pct_low),
    }

    const finals: number[] = []
    const calcs: number[] = []
    const predicteds: number[] = []
    // Distribuição de cada critério (slug → notas) pra colorir atributos por percentil.
    const criterionScores = new Map<string, number[]>()

    for (const row of (workRows ?? []) as Array<{
      calculated_scores:
        | { final_score: number | null; calc_score: number | null; predicted_score: number | null }
        | Array<{ final_score: number | null; calc_score: number | null; predicted_score: number | null }>
        | null
      category_scores?: Array<{ criterion_slug: string; score: number | null }> | null
    }>) {
      const cs = Array.isArray(row.calculated_scores) ? row.calculated_scores[0] : row.calculated_scores
      if (cs) {
        const f = cs.final_score == null ? Number.NaN : Number(cs.final_score)
        const c = cs.calc_score == null ? Number.NaN : Number(cs.calc_score)
        const p = cs.predicted_score == null ? Number.NaN : Number(cs.predicted_score)
        if (Number.isFinite(f)) finals.push(f)
        if (Number.isFinite(c)) calcs.push(c)
        if (Number.isFinite(p)) predicteds.push(p)
      }
      for (const catScore of row.category_scores ?? []) {
        const v = catScore.score == null ? Number.NaN : Number(catScore.score)
        if (!Number.isFinite(v)) continue
        const list = criterionScores.get(catScore.criterion_slug)
        if (list) list.push(v)
        else criterionScores.set(catScore.criterion_slug, [v])
      }
    }

    finals.sort((a, b) => a - b)
    calcs.sort((a, b) => a - b)
    predicteds.sort((a, b) => a - b)

    const final = computeColumn(finals, cfg)
    const calc = computeColumn(calcs, cfg)
    const predicted = computeColumn(predicteds, cfg)

    if (!final || !calc || !predicted) return null

    // Override por critério: criterion_color_pcts é um jsonb { slug: {top,high,mid,low} }.
    // Quando ausente (pré-migration) ou sem entrada pro slug, usa o cfg global.
    const overrides = (configRow as Record<string, unknown>).criterion_color_pcts
    const overrideMap = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, Partial<PctCfg>>

    const criteria: Record<string, ScoreColorThresholds> = {}
    for (const slug of CRITERION_SLUGS) {
      const scores = criterionScores.get(slug)
      if (!scores || scores.length < MIN_POOL_SIZE) continue
      scores.sort((a, b) => a - b)
      const ov = overrideMap[slug]
      const slugCfg: PctCfg = ov
        ? {
            top: Number(ov.top ?? cfg.top),
            high: Number(ov.high ?? cfg.high),
            mid: Number(ov.mid ?? cfg.mid),
            low: Number(ov.low ?? cfg.low),
          }
        : cfg
      const t = computeColumn(scores, slugCfg)
      if (t) criteria[slug] = t
    }

    return { final, calc, predicted, criteria }
  },
  ["score-color-thresholds-v3"],
  { revalidate: 300, tags: ["score-color-thresholds"] }
)
