import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"

export interface FavoritesSummary {
  total: number
  withFinalScore: number
  avgFinalScore: number | null
  topCriteria: Array<{ slug: CriterionSlug; avg: number; n: number }>
}

/**
 * Stats agregados das obras com `is_favorite = true`. Reflete a biblioteca
 * inteira de favoritos (não respeita filtros aplicados na página) — usado
 * pra contexto rápido no header de /favorites.
 */
async function _getFavoritesSummary(): Promise<FavoritesSummary> {
  const supabase = createAdminClient()

  const { data: works, error } = await supabase
    .from("works")
    .select(`
      id,
      calculated_scores(final_score),
      category_scores(criterion_slug, score)
    `)
    .eq("is_favorite", true)
    .eq("is_archived", false)

  if (error) {
    console.error("[favorites] erro lendo stats:", error)
    return { total: 0, withFinalScore: 0, avgFinalScore: null, topCriteria: [] }
  }

  const rows = (works ?? []) as unknown as Array<{
    id: string
    calculated_scores: { final_score: number | null } | null
    category_scores: Array<{ criterion_slug: string; score: number | null }> | null
  }>

  let finalSum = 0
  let finalCount = 0
  const critSum = new Map<string, number>()
  const critCount = new Map<string, number>()
  for (const w of rows) {
    const f = w.calculated_scores?.final_score
    if (f != null) {
      finalSum += Number(f)
      finalCount += 1
    }
    for (const cs of w.category_scores ?? []) {
      if (cs.score == null) continue
      const slug = cs.criterion_slug
      critSum.set(slug, (critSum.get(slug) ?? 0) + Number(cs.score))
      critCount.set(slug, (critCount.get(slug) ?? 0) + 1)
    }
  }

  const validSlugs = new Set<string>(CRITERION_SLUGS)
  const avgByCriterion: Array<{ slug: CriterionSlug; avg: number; n: number }> = []
  for (const [slug, sum] of critSum) {
    if (!validSlugs.has(slug)) continue
    const n = critCount.get(slug) ?? 0
    if (n === 0) continue
    avgByCriterion.push({ slug: slug as CriterionSlug, avg: sum / n, n })
  }
  avgByCriterion.sort((a, b) => b.avg - a.avg)

  return {
    total: rows.length,
    withFinalScore: finalCount,
    avgFinalScore: finalCount > 0 ? finalSum / finalCount : null,
    topCriteria: avgByCriterion.slice(0, 3),
  }
}

export const getFavoritesSummary = unstable_cache(
  _getFavoritesSummary,
  ["favorites-summary"],
  { revalidate: 300, tags: ["favorites-summary"] },
)
