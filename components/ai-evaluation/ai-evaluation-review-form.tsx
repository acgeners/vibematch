"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
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
  onSaved: (acceptedScores: Record<string, number>) => void
  onCancel: () => void
}

type ReviewUsageState =
  | { kind: "unavailable" } // sem reviews externas para essa obra
  | { kind: "declined" }    // reviews disponíveis mas modelo não citou nenhuma
  | { kind: "used"; count: number }

function getReviewUsage(rawResponse: unknown): ReviewUsageState {
  if (typeof rawResponse !== "object" || rawResponse === null) {
    return { kind: "unavailable" }
  }

  const raw = rawResponse as Record<string, unknown>
  const audit = raw.reviewAudit
  if (typeof audit !== "object" || audit === null) {
    return { kind: "unavailable" }
  }

  const reviewAudit = audit as Record<string, unknown>
  const usedReviewIds = Array.isArray(reviewAudit.usedReviewIds) ? reviewAudit.usedReviewIds : []

  if (reviewAudit.required !== true) {
    return { kind: "unavailable" }
  }
  if (usedReviewIds.length === 0) {
    return { kind: "declined" }
  }
  return { kind: "used", count: usedReviewIds.length }
}

interface EvaluationContextDebug {
  title?: string
  synopsis?: string | null
  synopsisIsManual?: boolean
  synopsisOmittedFromPrompt?: boolean
  genres?: string[]
  tagsGrouped?: Array<{ group: string | null; names: string[] }>
  externalContext?: string[]
  sourcedReviews?: Array<{
    id: string
    source: string
    sourceTitle: string
    matchScore: number
    text: string
    userRating?: number
  }>
  legacyReviews?: Array<{ id: string; text: string }>
  r19Detected?: boolean
}

function getEvaluationContext(rawResponse: unknown): EvaluationContextDebug | null {
  if (typeof rawResponse !== "object" || rawResponse === null) return null
  const ctx = (rawResponse as Record<string, unknown>).evaluationContext
  if (typeof ctx !== "object" || ctx === null) return null
  return ctx as EvaluationContextDebug
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
  const [showDebug, setShowDebug] = useState(false)
  const reviewUsage = getReviewUsage(evaluation.raw_response)
  const debugContext = getEvaluationContext(evaluation.raw_response)

  const reviewBadge = (() => {
    switch (reviewUsage.kind) {
      case "used":
        return {
          label: `${reviewUsage.count} review${reviewUsage.count === 1 ? "" : "s"} usada${reviewUsage.count === 1 ? "" : "s"}`,
          className: "border-emerald-300 bg-emerald-50 text-emerald-700",
        }
      case "declined":
        return {
          label: "reviews disponíveis, mas não usadas",
          className: "border-amber-300 bg-amber-50 text-amber-700",
        }
      case "unavailable":
      default:
        return {
          label: "sem reviews externas",
          className: "border-slate-300 bg-slate-100 text-slate-600",
        }
    }
  })()

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
    const scoreMap = Object.fromEntries(scores.map((s) => [s.criterionSlug, s.acceptedScore]))
    onSaved(scoreMap)
  }

  return (
    <div className="space-y-4">
      {evaluation.summary && (
        <div className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[96px_1fr]">
          <div className="relative h-36 w-24 overflow-hidden rounded-md border bg-muted">
            {coverUrl ? (
              <Image
                src={coverUrl}
                alt={`Capa de ${workId}`}
                fill
                sizes="96px"
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                Sem capa
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground">Resumo da IA</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${reviewBadge.className}`}
              >
                {reviewBadge.label}
              </span>
            </div>
            {evaluation.summary}
          </div>
        </div>
      )}

      {debugContext && (
        <details
          open={showDebug}
          onToggle={(e) => setShowDebug((e.target as HTMLDetailsElement).open)}
          className="rounded-md border border-dashed border-amber-300 bg-amber-50/40 p-3 text-xs"
        >
          <summary className="cursor-pointer text-xs font-medium text-amber-800">
            🐛 Dados usados na avaliação (debug temporário)
          </summary>
          <div className="mt-3 space-y-3 text-foreground">
            {debugContext.title && (
              <div>
                <p className="font-semibold">Título</p>
                <p className="text-muted-foreground">{debugContext.title}</p>
              </div>
            )}
            {debugContext.synopsis != null && (
              <div>
                <p className="font-semibold">
                  Sinopse{" "}
                  <span
                    className={
                      "ml-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium " +
                      (debugContext.synopsisIsManual
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-amber-300 bg-amber-50 text-amber-700")
                    }
                  >
                    {debugContext.synopsisIsManual ? "manual" : "auto/externa"}
                  </span>
                  {debugContext.synopsisOmittedFromPrompt && (
                    <span className="ml-2 text-[10px] font-normal text-amber-700">
                      (omitida do prompt — usando [C1]…[Cn])
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {debugContext.synopsis || "(vazia)"}
                </p>
              </div>
            )}
            {debugContext.genres && debugContext.genres.length > 0 && (
              <div>
                <p className="font-semibold">Gêneros ({debugContext.genres.length})</p>
                <p className="text-muted-foreground">{debugContext.genres.join(", ")}</p>
              </div>
            )}
            {debugContext.tagsGrouped && debugContext.tagsGrouped.length > 0 && (
              <div>
                <p className="font-semibold">
                  Tags por grupo (
                  {debugContext.tagsGrouped.reduce((acc, g) => acc + g.names.length, 0)})
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {debugContext.tagsGrouped.map((g, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{g.group ?? "(sem grupo)"}:</span>{" "}
                      {g.names.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.externalContext && debugContext.externalContext.length > 0 && (
              <div>
                <p className="font-semibold">
                  Contexto externo ({debugContext.externalContext.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.externalContext.map((c, i) => (
                    <li key={i} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[C{i + 1}]</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.sourcedReviews && debugContext.sourcedReviews.length > 0 && (
              <div>
                <p className="font-semibold">
                  Reviews externas ({debugContext.sourcedReviews.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.sourcedReviews.map((r) => (
                    <li key={r.id} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[{r.id}]</span>{" "}
                      <span className="text-[10px]">
                        ({r.source}, match {Math.round(r.matchScore * 100)}%
                        {r.userRating != null ? `, nota: ${r.userRating}/10` : ""}
                        , &ldquo;{r.sourceTitle}&rdquo;)
                      </span>
                      <br />
                      {r.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.legacyReviews && debugContext.legacyReviews.length > 0 && (
              <div>
                <p className="font-semibold">
                  Reviews (legado) ({debugContext.legacyReviews.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.legacyReviews.map((r) => (
                    <li key={r.id} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[{r.id}]</span> {r.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.r19Detected && (
              <p className="text-amber-700">⚠️ Marcador R19 detectado nas evidências.</p>
            )}
          </div>
        </details>
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
