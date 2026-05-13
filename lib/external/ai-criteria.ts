import type { CriterionSlug } from "@/types/domain"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"

export async function evaluateCriteriaWithAI(params: {
  title: string
  synopsis?: string
  genres: string[]
  tags: string[]
  reviews?: string[]
}): Promise<Partial<Record<CriterionSlug, number>> | null> {
  const hasData = params.synopsis || params.genres.length > 0 || params.tags.length > 0 || (params.reviews?.length ?? 0) > 0
  if (!hasData) return null

  try {
    const response = await requestAiEvaluation({
      workId: `external:${params.title}`,
      title: params.title,
      synopsis: params.synopsis,
      genres: params.genres,
      tags: params.tags,
      reviews: params.reviews,
      promptVersion: "v8",
    })

    const result: Partial<Record<CriterionSlug, number>> = {}
    for (const score of response.scores) {
      const value = Number(score.suggestedScore)
      if (Number.isFinite(value) && value >= 0 && value <= 10) {
        result[score.criterionSlug as CriterionSlug] = Math.round(value * 10) / 10
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}
