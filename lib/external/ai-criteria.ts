import type { CriterionSlug } from "@/types/domain"
import { requestAiEvaluation, type AiEvaluationTag } from "@/lib/ai-evaluation/service"

export interface AiCriteriaResult {
  scores: Partial<Record<CriterionSlug, number>>
  meta: { inputHash: string; modelName: string; promptVersion: string }
}

export async function evaluateCriteriaWithAI(params: {
  title: string
  synopsis?: string
  genres: string[]
  tags: Array<string | AiEvaluationTag>
  reviews?: string[]
}): Promise<AiCriteriaResult | null> {
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
    })

    const scores: Partial<Record<CriterionSlug, number>> = {}
    for (const score of response.scores) {
      const value = Number(score.suggestedScore)
      if (Number.isFinite(value) && value >= 0 && value <= 10) {
        scores[score.criterionSlug as CriterionSlug] = Math.round(value * 10) / 10
      }
    }

    if (Object.keys(scores).length === 0) return null

    return {
      scores,
      meta: {
        inputHash: response.inputHash,
        modelName: response.modelName,
        promptVersion: response.promptVersion,
      },
    }
  } catch {
    return null
  }
}
