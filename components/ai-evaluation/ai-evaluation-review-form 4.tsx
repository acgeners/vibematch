"use client"

import { useMemo, useState } from "react"
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
  coverUrl?: string | null
  currentScores?: Record<string, number>
  onSaved: () => void
  onCancel: () => void
}

export function AiEvaluationReviewForm({
  evaluation,
  workId,
  coverUrl,
  currentScores,
  onSaved,
  onCancel,
}: AiEvaluationReviewFormProps) {
  const initialScores = useMemo(
    () =>
      (evaluation.ai_evaluation_scores ?? []).map((s) => ({
        criterionSlug: s.criterion_slug,
        suggestedScore: s.suggested_score ?? 0,
        acceptedScore: s.suggested_score ?? 0,
        currentScore: currentScores?.[s.criterion_slug],
        justification: s.justification,
        wasEdited: false,
      })),
    [currentScores, evaluation.ai_evaluation_scores]
  )

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

  const resetToSuggested = () => {
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

    toast.success("Notas salvas.")
    onSaved()
  }

  return (
    <div className="space-y-4">
      {evaluation.summary && (
        <div className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[96px_1fr]">
          <div className="h-36 w-24 overflow-hidden rounded-md border bg-muted">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`Capa de ${workId}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                Sem capa
              </div>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Resumo da IA</p>
            {evaluation.summary}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {scores.map((s) => {
          const info = CRITERIA_INFO[s.criterionSlug]
          const hasCurrentScore = s.currentScore !== undefined
          return (
            <div key={s.criterionSlug} className="grid grid-cols-1 gap-1 p-3 border rounded-md">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {info?.emoji} {info?.name ?? s.criterionSlug}
                </Label>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {hasCurrentScore && (
                    <button
                      type="button"
                      className="hover:text-foreground transition-colors"
                      title="Clique para usar nota atual"
                      onClick={() => updateScore(s.criterionSlug, s.currentScore!)}
                    >
                      Atual: <strong>{s.currentScore!.toFixed(1)}</strong>
                    </button>
                  )}
                  <button
                    type="button"
                    className="hover:text-foreground transition-colors"
                    title="Clique para usar sugestão da IA"
                    onClick={() => updateScore(s.criterionSlug, s.suggestedScore)}
                  >
                    Sugerido: <strong>{s.suggestedScore.toFixed(1)}</strong>
                  </button>
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
        <Button variant="secondary" size="sm" onClick={resetToSuggested}>
          Resetar
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  )
}
