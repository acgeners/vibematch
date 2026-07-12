"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PostReadingFlow } from "@/components/titles/post-reading-flow"
import type { PostAttributeAssessmentFormProps } from "@/components/titles/post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

export interface StatusEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workId: string
  totalChapters: number | null
  initialValues: WorkStatusValues
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  /** Critérios/notas de gosto ("Como foi pra você"). Sem eles a seção não aparece. */
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  tasteEndingNa?: boolean
}

export function StatusEditDialog({
  open,
  onOpenChange,
  workId,
  totalChapters,
  initialValues,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria,
  tasteScores,
  tasteEndingNa,
}: StatusEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meu Status</DialogTitle>
          <DialogDescription>
            Atualize status, anotações, critérios de avaliação e atributos da obra.
          </DialogDescription>
        </DialogHeader>

        {/* Mesmo conteúdo da aba "Meu Status". formId distinto evita colisão de
            id quando a aba também está montada. */}
        <PostReadingFlow
          workId={workId}
          totalChapters={totalChapters}
          statusInitial={initialValues}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
          tasteCriteria={tasteCriteria}
          tasteScores={tasteScores}
          tasteEndingNa={tasteEndingNa}
          formId="work-status-form-dialog"
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
