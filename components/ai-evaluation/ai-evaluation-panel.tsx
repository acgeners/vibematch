"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckSquare, ListChecks, Loader2, Sparkles, SkipForward, X } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation, skipAiEvaluation } from "@/server/actions/ai"
import { AiEvaluationReviewForm } from "./ai-evaluation-review-form"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AiEvaluation } from "@/types/domain"

interface PendingWork {
  id: string
  title: string
  publication_status: string
  publication_status_id: number | null
  personal_status: string
  personal_status_id: number | null
  total_chapters: number | null
  cover_url?: string | null
  final_score: number | null
}

interface AiEvaluationPanelProps {
  pendingWorks: PendingWork[]
}

interface ReviewData {
  evaluation: AiEvaluation
  workId: string
  workTitle: string
  coverUrl: string | null
  currentScores: Record<string, number>
}

export function AiEvaluationPanel({ pendingWorks }: AiEvaluationPanelProps) {
  const router = useRouter()
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const [skippingId, setSkippingId] = useState<string | null>(null)
  const [reviewData, setReviewData] = useState<ReviewData | null>(null)
  const [queue, setQueue] = useState<PendingWork[]>([])
  const [queueResults, setQueueResults] = useState<ReviewData[]>([])
  const [queueReviewIndex, setQueueReviewIndex] = useState(0)
  const [queueProcessedCount, setQueueProcessedCount] = useState(0)
  const [queueSize, setQueueSize] = useState<number>(10)
  const queueCancelledRef = useRef(false)
  const reviewScrollRef = useRef<HTMLDivElement | null>(null)

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelectionMode = () => {
    setSelectionMode((v) => !v)
    setSelected(new Set())
  }

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(pendingWorks.map((w) => w.id)))
  const deselectAll = () => setSelected(new Set())
  const allSelected = selected.size === pendingWorks.length
  const someSelected = selected.size > 0 && !allSelected

  // Queue logic
  const runEvaluation = async (work: PendingWork): Promise<ReviewData | null> => {
    setEvaluatingId(work.id)
    const result = await triggerAiEvaluation(work.id)
    setEvaluatingId(null)

    if (result.error) {
      toast.error(`Erro na avaliação de "${work.title}": ${result.error}`)
      return null
    }

    if (!result.data?.evaluation) {
      toast.error("Avaliação concluída, mas as notas não foram retornadas.")
      return null
    }

    return {
      evaluation: result.data.evaluation,
      workId: work.id,
      workTitle: work.title,
      coverUrl: work.cover_url ?? null,
      currentScores: result.data.currentScores ?? {},
    }
  }

  const handleEvaluate = async (work: PendingWork) => {
    const result = await runEvaluation(work)
    if (result) setReviewData(result)
  }

  const startQueue = async (works?: PendingWork[]) => {
    const source = works ?? pendingWorks.slice(0, Math.max(1, Math.min(queueSize, pendingWorks.length)))
    if (source.length === 0) return

    queueCancelledRef.current = false
    setQueue(source)
    setQueueResults([])
    setQueueReviewIndex(0)
    setQueueProcessedCount(0)
    setReviewData(null)

    const results: ReviewData[] = []

    for (let index = 0; index < source.length; index += 1) {
      if (queueCancelledRef.current) return

      setQueueProcessedCount(index + 1)
      const result = await runEvaluation(source[index])
      if (queueCancelledRef.current) return

      if (result) results.push(result)
    }

    if (queueCancelledRef.current) return

    if (results.length === 0) {
      setQueue([])
      setQueueProcessedCount(0)
      router.refresh()
      return
    }

    setQueueResults(results)
    setQueueReviewIndex(0)
    setReviewData(results[0])
  }

  const handleSaved = async (_acceptedScores?: Record<string, number>) => {
    if (queueResults.length > 0 && queueReviewIndex < queueResults.length - 1) {
      const nextIndex = queueReviewIndex + 1
      setQueueReviewIndex(nextIndex)
      setReviewData(queueResults[nextIndex])
      requestAnimationFrame(() => {
        reviewScrollRef.current?.scrollTo({ top: 0 })
      })
    } else {
      setReviewData(null)
      setQueue([])
      setQueueResults([])
      setQueueReviewIndex(0)
      setQueueProcessedCount(0)
      router.refresh()
    }
  }

  const handleCancel = () => {
    queueCancelledRef.current = true
    setReviewData(null)
    setQueue([])
    setQueueResults([])
    setQueueReviewIndex(0)
    setQueueProcessedCount(0)
    router.refresh()
  }

  const handleSkip = async (workId: string) => {
    setSkippingId(workId)
    await skipAiEvaluation(workId)
    setSkippingId(null)
    toast.success("Obra marcada para pular avaliação IA")
    router.refresh()
  }

  const handleEvaluateSelected = async () => {
    const works = pendingWorks.filter((w) => selected.has(w.id))
    setSelectionMode(false)
    setSelected(new Set())
    await startQueue(works)
  }

  const handleSkipSelected = async () => {
    const ids = [...selected]
    setSelectionMode(false)
    setSelected(new Set())
    for (const id of ids) {
      await skipAiEvaluation(id)
    }
    toast.success(`${ids.length} obra${ids.length !== 1 ? "s" : ""} pulada${ids.length !== 1 ? "s" : ""}`)
    router.refresh()
  }

  const isInQueue = queue.length > 0
  const queuePosition = isInQueue && reviewData && queueResults.length > 0
    ? queueReviewIndex + 1
    : 0
  const isQueueEvaluating = isInQueue && queueResults.length === 0
  const evaluatingWork = evaluatingId
    ? pendingWorks.find((work) => work.id === evaluatingId)
    : null
  const queueProgress = queue.length > 0 ? (queueProcessedCount / queue.length) * 100 : 0

  if (pendingWorks.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Nenhuma obra pendente de avaliação IA.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {isInQueue && !isQueueEvaluating && (
        <div className="flex items-center justify-between px-4 py-2 rounded-md bg-muted text-sm">
          <span className="text-muted-foreground">
            Revisão: <strong>{queuePosition}</strong> de <strong>{queueResults.length}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleCancel}
          >
            <X className="h-3 w-3 mr-1" /> Cancelar fila
          </Button>
        </div>
      )}

      <Dialog open={isQueueEvaluating} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <DialogTitle>Avaliando em fila</DialogTitle>
            <DialogDescription>
              Fila: {queueProcessedCount} de {queue.length} · Avaliando...
            </DialogDescription>
          </DialogHeader>
          <Progress value={queueProgress} />
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1.5" />
            Cancelar fila
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(evaluatingWork) && !isQueueEvaluating} onOpenChange={() => undefined}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <DialogTitle>Avaliando com IA</DialogTitle>
            <DialogDescription>
              {evaluatingWork
                ? `Preparando reviews externas e notas para "${evaluatingWork.title}".`
                : "Preparando reviews externas e notas."}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Toolbar */}
      {!isInQueue && (
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <>
              {/* Select all checkbox */}
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => (v ? selectAll() : deselectAll())}
                className="shrink-0"
              />
              <span className="text-xs text-muted-foreground">
                {selected.size} selecionada{selected.size !== 1 ? "s" : ""}
              </span>

              <div className="flex-1" />

              <Button
                variant="outline"
                size="sm"
                onClick={handleSkipSelected}
                disabled={selected.size === 0}
              >
                <SkipForward className="h-3.5 w-3.5 mr-1.5" />
                Pular selecionadas
              </Button>
              <Button
                size="sm"
                onClick={handleEvaluateSelected}
                disabled={selected.size === 0}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Avaliar selecionadas ({selected.size})
              </Button>
              <Button variant="ghost" size="sm" onClick={toggleSelectionMode}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={toggleSelectionMode}>
                <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                Selecionar
              </Button>

              <div className="flex-1" />

              <span className="text-xs text-muted-foreground">Quantos:</span>
              <Input
                type="number"
                min={1}
                max={pendingWorks.length}
                value={queueSize}
                onChange={(e) => setQueueSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-8 w-20 text-xs"
              />
              <Button variant="outline" size="sm" onClick={() => startQueue()}>
                <ListChecks className="h-3.5 w-3.5 mr-1.5" />
                Avaliar em fila
              </Button>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        {pendingWorks.map((work) => (
          <Card
            key={work.id}
            className={[
              evaluatingId === work.id ? "opacity-60" : "",
              selectionMode ? "cursor-pointer" : "",
              selectionMode && selected.has(work.id) ? "border-primary/60 bg-primary/5" : "",
            ].filter(Boolean).join(" ")}
            onClick={selectionMode ? () => toggleItem(work.id) : undefined}
          >
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                {selectionMode && (
                  <Checkbox
                    checked={selected.has(work.id)}
                    onCheckedChange={() => toggleItem(work.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <span onClick={(e) => e.stopPropagation()} className="block truncate">
                    <WorkTitleLink
                      title={work.title}
                      workId={work.id}
                      className="font-medium hover:underline"
                    />
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <PublicationStatusBadge statusId={work.publication_status_id ?? null} />
                    <PersonalStatusBadge statusId={work.personal_status_id ?? null} />
                  </div>
                  {work.total_chapters != null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {work.total_chapters} capítulos
                    </p>
                  )}
                </div>
                {!selectionMode && (
                  <div className="flex items-center gap-2 shrink-0">
                    <ScoreBadge score={work.final_score} size="sm" />
                    <Button
                      size="sm"
                      onClick={() => handleEvaluate(work)}
                      disabled={!!evaluatingId || !!skippingId || isInQueue}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {evaluatingId === work.id ? "Avaliando..." : "Avaliar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleSkip(work.id)}
                      disabled={!!evaluatingId || !!skippingId || isInQueue}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {selectionMode && (
                  <ScoreBadge score={work.final_score} size="sm" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Review Dialog */}
      <Dialog open={reviewData != null} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent ref={reviewScrollRef} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisão da avaliação IA</DialogTitle>
            {reviewData && (
              <div className="flex items-start justify-between gap-4">
                <p className="text-xl font-semibold leading-tight text-foreground">{reviewData.workTitle}</p>
                {isInQueue && queuePosition > 0 && (
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {queuePosition} de {queueResults.length}
                  </p>
                )}
              </div>
            )}
          </DialogHeader>
          {reviewData && (
            <AiEvaluationReviewForm
              key={reviewData.evaluation.id}
              evaluation={reviewData.evaluation}
              workId={reviewData.workId}
              coverUrl={reviewData.coverUrl}
              currentScores={reviewData.currentScores}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
