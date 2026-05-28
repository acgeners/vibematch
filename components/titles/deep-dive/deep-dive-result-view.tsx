"use client"

import { useState } from "react"
import { DeepDiveHeader } from "./deep-dive-header"
import { DeepDiveRecommendationCard } from "./deep-dive-recommendation-card"
import { DeepDiveMoodSection } from "./deep-dive-mood-section"
import { DeepDiveAlignmentSection } from "./deep-dive-alignment-section"
import { DeepDiveSimilarSection } from "./deep-dive-similar-section"
import { DeepDiveReviewsSection } from "./deep-dive-reviews-section"
import { DeepDiveHistorySection } from "./deep-dive-history-section"
import type { DeepDiveResultRow } from "@/lib/ai-recommendation/types"

interface DeepDiveResultViewProps {
  dive: DeepDiveResultRow
  workId: string
}

export function DeepDiveResultView({ dive: initialDive, workId }: DeepDiveResultViewProps) {
  // Permite trocar pra uma análise anterior via histórico sem recarregar o drawer.
  const [active, setActive] = useState<DeepDiveResultRow>(initialDive)
  const payload = active.payload

  return (
    <div className="space-y-4">
      <DeepDiveHeader payload={payload} />

      <DeepDiveRecommendationCard payload={payload} />

      {payload.mood_match && (
        <DeepDiveMoodSection mood={payload.mood_match} userContext={active.user_context} />
      )}

      <DeepDiveAlignmentSection alignment={payload.alignment_breakdown} />

      {payload.similar_in_library.length > 0 && (
        <DeepDiveSimilarSection items={payload.similar_in_library} />
      )}

      <DeepDiveReviewsSection synthesis={payload.review_synthesis} />

      <DeepDiveHistorySection
        workId={workId}
        currentId={active.id}
        onSelect={(next) => setActive(next)}
      />
    </div>
  )
}
