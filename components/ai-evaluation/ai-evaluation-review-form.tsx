"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { submitAiReview } from "@/server/actions/ai"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Label } from "@/components/ui/label"
import { cn, titleToSlug } from "@/lib/utils"
import {
  NO_REVIEWS_REASON_LABEL,
  NO_REVIEWS_REASON_CTA,
  isNoReviewsReason,
} from "@/lib/ai-evaluation/no-reviews"
import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"
import type { AiEvaluation } from "@/types/domain"

// Limiar fixo de fricção no "Aceitar todos" e no botão "Reavaliar com Opus".
// Desacoplado do `formula_config.low_confidence_threshold` (que controla o
// filtro da fila): aqui o objetivo é só pedir confirmação quando há risco real,
// alinhado com a faixa amarela/vermelha dos badges (≥75% = verde, sem fricção).
const CONFIRM_THRESHOLD = 0.7

type ReevalModel = "sonnet" | "opus"

interface AiEvaluationReviewFormProps {
  evaluation: AiEvaluation
  workId: string
  workTitle: string
  coverUrl?: string | null
  currentScores?: Record<string, number>
  /** Quando fornecido, mostra botão de re-avaliar com modelo alternativo em caso de confiança baixa. */
  onReevaluate?: (model: ReevalModel) => Promise<void> | void
  onSaved: (acceptedScores: Record<string, number>) => void
  onCancel: () => void
}


function getNoReviewsReason(rawResponse: unknown): NoReviewsReason | null {
  if (typeof rawResponse !== "object" || rawResponse === null) return null
  const ctx = (rawResponse as Record<string, unknown>).evaluationContext
  if (typeof ctx !== "object" || ctx === null) return null
  const value = (ctx as Record<string, unknown>).noReviewsReason
  return isNoReviewsReason(value) ? value : null
}

type ReviewUsageState =
  | { kind: "unavailable" } // sem reviews externas para essa obra
  | { kind: "declined"; available: number }    // reviews disponíveis mas modelo não citou nenhuma
  | { kind: "used"; count: number; available: number }

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.75) return "border-emerald-300 bg-emerald-50 text-emerald-700"
  if (confidence >= 0.5) return "border-amber-300 bg-amber-50 text-amber-700"
  return "border-rose-300 bg-rose-50 text-rose-700"
}

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
  const expectedIds = Array.isArray(reviewAudit.expectedReviewIds) ? reviewAudit.expectedReviewIds : []
  // expectedReviewIds = todas as reviews enviadas pro prompt (R1..Rn).
  // Fallback pra contar via evaluationContext.sourcedReviews quando não tem.
  let available = expectedIds.length
  if (!available) {
    const ctx = (raw.evaluationContext ?? {}) as { sourcedReviews?: unknown[]; legacyReviews?: unknown[] }
    available =
      (Array.isArray(ctx.sourcedReviews) ? ctx.sourcedReviews.length : 0) +
      (Array.isArray(ctx.legacyReviews) ? ctx.legacyReviews.length : 0)
  }

  if (reviewAudit.required !== true) {
    return { kind: "unavailable" }
  }
  if (usedReviewIds.length === 0) {
    return { kind: "declined", available }
  }
  return { kind: "used", count: usedReviewIds.length, available }
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
  workTitle,
  coverUrl,
  currentScores,
  onReevaluate,
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
        mode: "suggested" as "current" | "suggested" | "custom",
      })),
    [currentScores, evaluation.ai_evaluation_scores]
  )

  const [scores, setScores] = useState(initialScores)
  const [submitting, setSubmitting] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [confirmAcceptAllOpen, setConfirmAcceptAllOpen] = useState(false)
  const [reevaluatingModel, setReevaluatingModel] = useState<ReevalModel | null>(null)
  const [coverFailed, setCoverFailed] = useState(false)
  const reviewUsage = getReviewUsage(evaluation.raw_response)
  const debugContext = getEvaluationContext(evaluation.raw_response)
  const noReviewsReason = getNoReviewsReason(evaluation.raw_response)
  const isLowConfidence =
    evaluation.confidence != null && evaluation.confidence < CONFIRM_THRESHOLD
  const thresholdPct = Math.round(CONFIRM_THRESHOLD * 100)

  const reviewBadge = (() => {
    switch (reviewUsage.kind) {
      case "used": {
        const ofTotal =
          reviewUsage.available > 0 ? ` de ${reviewUsage.available}` : ""
        return {
          label: `${reviewUsage.count}${ofTotal} reviews citadas pela IA`,
          className: "border-emerald-300 bg-emerald-50 text-emerald-700",
        }
      }
      case "declined":
        return {
          label:
            reviewUsage.available > 0
              ? `${reviewUsage.available} reviews disponíveis, mas não usadas`
              : "reviews disponíveis, mas não usadas",
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

  const selectMode = (slug: string, mode: "current" | "suggested" | "custom") => {
    setScores((prev) =>
      prev.map((s) => {
        if (s.criterionSlug !== slug) return s
        const value =
          mode === "current" && s.currentScore !== undefined
            ? s.currentScore
            : mode === "suggested"
              ? s.suggestedScore
              : s.acceptedScore
        return {
          ...s,
          mode,
          acceptedScore: value,
          wasEdited: value !== s.suggestedScore,
        }
      })
    )
  }

  const updateCustomScore = (slug: string, value: number) => {
    setScores((prev) =>
      prev.map((s) =>
        s.criterionSlug === slug
          ? {
              ...s,
              mode: "custom",
              acceptedScore: value,
              wasEdited: value !== s.suggestedScore,
            }
          : s
      )
    )
  }

  const resetToSuggested = () => {
    setScores((prev) =>
      prev.map((s) => ({
        ...s,
        mode: "suggested",
        acceptedScore: s.suggestedScore,
        wasEdited: false,
      }))
    )
  }

  const submitScores = async (scoresToSubmit: typeof scores) => {
    setSubmitting(true)
    try {
      const result = await submitAiReview({
        evaluationId: evaluation.id,
        workId,
        scores: scoresToSubmit.map((s) => ({
          criterionSlug: s.criterionSlug,
          acceptedScore: s.acceptedScore,
          wasEdited: s.wasEdited,
        })),
      })

      if (result.error) {
        toast.error(`Erro ao salvar revisão: ${result.error}`)
        return
      }

      toast.success("Notas salvas.")
      const scoreMap = Object.fromEntries(scoresToSubmit.map((s) => [s.criterionSlug, s.acceptedScore]))
      onSaved(scoreMap)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Erro ao salvar revisão: ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = () => submitScores(scores)

  const doAcceptAll = () => {
    // Reseta todos pros valores sugeridos pela IA (descarta edits) e salva.
    const allSuggested = scores.map((s) => ({
      ...s,
      acceptedScore: s.suggestedScore,
      wasEdited: false,
    }))
    setScores(allSuggested)
    void submitScores(allSuggested)
  }

  const handleAcceptAll = () => {
    if (isLowConfidence) {
      setConfirmAcceptAllOpen(true)
      return
    }
    doAcceptAll()
  }

  const handleReevaluate = async (model: ReevalModel) => {
    if (!onReevaluate || reevaluatingModel) return
    setReevaluatingModel(model)
    try {
      await onReevaluate(model)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Erro ao reavaliar: ${message}`)
    } finally {
      setReevaluatingModel(null)
    }
  }

  const showOpusButton =
    !!onReevaluate && isLowConfidence && evaluation.model_name !== "claude-opus-4-7"

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirmAcceptAllOpen}
        onOpenChange={setConfirmAcceptAllOpen}
        title="Confiança baixa"
        description={`A IA declarou ${
          evaluation.confidence != null ? `${Math.round(evaluation.confidence * 100)}%` : "?"
        } de confiança, abaixo do limiar configurado (${thresholdPct}%). Quer aceitar todas as notas mesmo assim?`}
        confirmText="Aceitar todos"
        cancelText="Voltar"
        onConfirm={() => doAcceptAll()}
      />

      <div className="flex justify-end">
        <Button size="sm" onClick={handleAcceptAll} disabled={submitting}>
          {submitting ? "Salvando..." : "Aceitar todos"}
        </Button>
      </div>

      {evaluation.summary && (
        <div className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[96px_1fr]">
          <div className="relative h-36 w-24 overflow-hidden rounded-md border bg-muted">
            {coverUrl && !coverFailed ? (
              <Image
                src={getCoverImageSrc(coverUrl)}
                alt={`Capa de ${workId}`}
                fill
                sizes="96px"
                unoptimized
                className="h-full w-full object-cover"
                onError={() => setCoverFailed(true)}
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
              {evaluation.confidence != null && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(evaluation.confidence)}`}
                  title="Confiança declarada pela IA: 0 = sem certeza, 1 = alta certeza"
                >
                  Confiança: {Math.round(evaluation.confidence * 100)}%
                </span>
              )}
            </div>
            {evaluation.summary}
            {reviewUsage.kind === "unavailable" && noReviewsReason && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Motivo:</span>{" "}
                {NO_REVIEWS_REASON_LABEL[noReviewsReason]}.{" "}
                {NO_REVIEWS_REASON_CTA[noReviewsReason] && (
                  <Link
                    href={`/titles/${titleToSlug(workTitle)}#external-sources`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {NO_REVIEWS_REASON_CTA[noReviewsReason]}
                  </Link>
                )}
              </p>
            )}
            {showOpusButton && (
              <div className="mt-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!reevaluatingModel || submitting}
                  onClick={() => void handleReevaluate("opus")}
                  title="Modelo alternativo. Nota.Final continua usando calibração do Sonnet."
                >
                  {reevaluatingModel === "opus" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  Reavaliar com Opus 4.7
                </Button>
              </div>
            )}
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
          const isCurrent = s.mode === "current"
          const isSuggested = s.mode === "suggested"
          const isCustom = s.mode === "custom"
          return (
            <div key={s.criterionSlug} className="space-y-2 p-3 border rounded-md">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">
                  {info?.emoji} {info?.name ?? s.criterionSlug}
                </Label>
                {s.wasEdited && (
                  <span className="text-xs text-amber-600 font-medium">Editado</span>
                )}
              </div>

              <div
                className={cn(
                  "grid gap-1 rounded-md border bg-muted/30 p-1",
                  hasCurrentScore ? "grid-cols-3" : "grid-cols-2"
                )}
              >
                {hasCurrentScore && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isCurrent ? "default" : "ghost"}
                    onClick={() => selectMode(s.criterionSlug, "current")}
                    className="h-auto flex-col gap-0.5 py-1.5"
                  >
                    <span className="text-[10px] uppercase tracking-wide opacity-80">
                      Atual
                    </span>
                    <span className="font-mono text-base font-bold leading-none">
                      {s.currentScore!.toFixed(1)}
                    </span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={isSuggested ? "default" : "ghost"}
                  onClick={() => selectMode(s.criterionSlug, "suggested")}
                  className="h-auto flex-col gap-0.5 py-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    Sugerido
                  </span>
                  <span className="font-mono text-base font-bold leading-none">
                    {s.suggestedScore.toFixed(1)}
                  </span>
                </Button>
                {isCustom ? (
                  <div
                    className={cn(
                      buttonVariants({ variant: "default", size: "sm" }),
                      "h-auto flex-col gap-0.5 py-1.5"
                    )}
                  >
                    <span className="text-[10px] uppercase tracking-wide opacity-80">
                      Personalizado
                    </span>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={10}
                      autoFocus
                      value={s.acceptedScore}
                      onChange={(e) =>
                        updateCustomScore(
                          s.criterionSlug,
                          parseFloat(e.target.value) || 0
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 rounded bg-background/20 text-center font-mono text-base font-bold leading-none text-primary-foreground outline-none ring-1 ring-background/30 focus:ring-2 focus:ring-background/60"
                    />
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => selectMode(s.criterionSlug, "custom")}
                    className="h-auto flex-col gap-0.5 py-1.5"
                  >
                    <span className="text-[10px] uppercase tracking-wide opacity-80">
                      Personalizado
                    </span>
                    <span className="font-mono text-base font-bold leading-none">
                      —
                    </span>
                  </Button>
                )}
              </div>

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
