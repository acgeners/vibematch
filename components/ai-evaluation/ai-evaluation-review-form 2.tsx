"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { submitAiReview } from "@/server/actions/ai"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AiEvaluation } from "@/types/domain"

interface AiEvaluationReviewFormProps {
  evaluation: AiEvaluation
  workId: string
  onClose: () => void
}

export function AiEvaluationReviewForm({
  evaluation,
  workId,
  onClose,
}: AiEvaluationReviewFormProps) {
  const router = useRouter()

  const initialScores = (evaluation.ai_evaluation_scores ?? []).map((s) => ({
    criterionSlug: s.criterion_slug,
    suggestedScore: s.suggested_score ?? 0,
    acceptedScore: s.suggested_score ?? 0,
    justification: s.justification,
    wasEdited: false,
  }))

  const [scores, setScores] = useState(initialScores)
  const [submitting, setSubmitting] = useState(false)

  const updateScore = (slug: string, value: number) => {
    setScores((prev) =>
      prev.map((s) =>
        s.criterionSlug === slug
          ? { ...s, acceptedScore: value, wasEdited: value !== s.suggestedScore }
          : s
      )
    )
  }

  const acceptAll = () => {
    setScores((prev) =>
      prev.map((s) => ({
        ...s,
        acceptedScore: s.suggestedScore,
        wasEdited: false,
      }))
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    const result = await submitAiReview({
      evaluationId: evaluation.id,
      workId,
      scores: scores.map((s) => ({
        criterionSlug: s.criterionSlug,
        acceptedScore: s.acceptedScore,
        wasEdited: s.wasEdited,
      })),
    })

    setSubmitting(false)

    if (result.error) {
      toast.error(`Erro ao salvar revisão: ${result.error}`)
      return
    }

    toast.success("Notas aprovadas e salvas em category_scores.")
    router.refresh()
    onClose()
  }

  return (
    <div className="space-y-4">
      {evaluation.summary && (
        <div className="p-3 rounded-md bg-muted/50 text-sm">
          <p className="font-medium text-xs text-muted-foreground mb-1">Resumo da IA</p>
          {evaluation.summary}
        </div>
      )}

      <div className="space-y-3">
        {scores.map((s) => {
          const info = CRITERIA_INFO[s.criterionSlug]
          return (
            <div key={s.criterionSlug} className="grid grid-cols-1 gap-1 p-3 border rounded-md">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {info?.emoji} {info?.name ?? s.criterionSlug}
                </Label>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Sugerido: <strong>{s.suggestedScore.toFixed(1)}</strong></span>
                  {s.wasEdited && (
                    <span className="text-amber-600 font-medium">Editado</span>
                  )}
                </div>
              </div>
              <Input
                type="number"
                step={0.5}
                min={0}
                max={10}
                value={s.acceptedScore}
                onChange={(e) => updateScore(s.criterionSlug, parseFloat(e.target.value) || 0)}
                className="h-8 text-sm"
              />
              {s.justification && (
                <p className="text-xs text-muted-foreground">{s.justification}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={acceptAll}>
          Aceitar tudo
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Salvando..." : "Aprovar e salvar notas"}
        </Button>
      </div>
    </div>
  )
}
