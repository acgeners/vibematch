"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { Button } from "@/components/ui/button"
import { saveManualReviews } from "@/server/actions/manual-reviews"
import type { ManualReview } from "@/types/domain"
import {
  ReviewDraftsField,
  draftsToManualReviewInput,
  manualReviewsToDrafts,
} from "@/components/titles/review-drafts-field"
import type { ReviewDraft } from "@/components/titles/review-drafts-field"

interface ManualReviewsCardProps {
  workId: string
  initialReviews: ManualReview[]
}

/**
 * Card auto-persistente de reviews manuais para a página de edição da obra.
 * Independente do form principal — salva direto via `saveManualReviews`.
 */
export function ManualReviewsCard({ workId, initialReviews }: ManualReviewsCardProps) {
  const [drafts, setDrafts] = useState<ReviewDraft[]>(() => manualReviewsToDrafts(initialReviews))
  const [pending, startTransition] = useTransition()

  const save = () => {
    startTransition(async () => {
      const result = await saveManualReviews(workId, draftsToManualReviewInput(drafts))
      if (result.error) {
        toast.error(`Falha ao salvar reviews: ${result.error}`)
        return
      }
      setDrafts(manualReviewsToDrafts(result.data ?? []))
      toast.success("Reviews manuais salvas")
    })
  }

  return (
    <CollapsibleCard
      title="Reviews para avaliação IA"
      description="Comentários seus sobre a obra. Sobrevivem às buscas externas e entram sempre no prompt como evidência direta."
      defaultOpen={initialReviews.length > 0}
      action={
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Salvando…" : "Salvar reviews"}
        </Button>
      }
    >
      <ReviewDraftsField value={drafts} onChange={setDrafts} disabled={pending} />
    </CollapsibleCard>
  )
}
