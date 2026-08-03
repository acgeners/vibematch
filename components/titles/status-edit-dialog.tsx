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
  /** `works.publication_status_id` — o aviso de coerência do form depende dele. */
  publicationStatusId?: number | null
  /** true ⇒ curador: o aviso oferece corrigir a publicação. */
  canEditCatalog?: boolean
  initialValues: WorkStatusValues
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  /** Critérios/notas de gosto ("Como foi pra você"). Sem eles a seção não aparece. */
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  formId?: string
}

export function StatusEditDialog({
  open,
  onOpenChange,
  workId,
  totalChapters,
  publicationStatusId = null,
  canEditCatalog = false,
  initialValues,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria,
  tasteScores,
  formId = "work-status-form-dialog",
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
          publicationStatusId={publicationStatusId}
          canEditCatalog={canEditCatalog}
          statusInitial={initialValues}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
          tasteCriteria={tasteCriteria}
          tasteScores={tasteScores}
          formId={formId}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
