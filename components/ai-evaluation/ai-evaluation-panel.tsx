"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CalendarDays, Cpu, ExternalLink, ListChecks, Loader2, Sparkles, SkipForward, X } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation, skipAiEvaluation, prewarmEvaluationContext } from "@/server/actions/ai"
import { getComixHealthStatus } from "@/server/actions/comix-resolver"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { previewCascade } from "@/lib/cost-preview/catalog"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"
import { AiEvaluationReviewForm } from "./ai-evaluation-review-form"
import type { CurrentEvaluationMeta } from "./ai-evaluation-review-form"
import { AiEvaluationCompare } from "./ai-evaluation-compare"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { titleToSlug } from "@/lib/utils"
import { LABELS } from "@/lib/constants/ui-labels"
import { NO_REVIEWS_REASON_LABEL } from "@/lib/ai-evaluation/no-reviews"
import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"
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
  synopsis_quality?: string | null
  cover_url?: string | null
  expected_score?: number | null
  tagCount?: number | null
  reviewCount?: number | null
  matchedFilters?: Array<"pending" | "review-pending" | "low-confidence" | "outdated-model" | "outdated-reviews">
  evaluation?: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
    evaluatedAt: string | null
  } | null
}

interface AiEvaluationPanelProps {
  pendingWorks: PendingWork[]
  readIds?: string[]
}

// Quantas avaliações IA rodam em paralelo no lote. O gargalo é a chamada do
// LLM (~50s cada); 3 simultâneas reduzem o tempo total sem martelar a API
// (maxRetries no client absorve eventuais 529).
const QUEUE_CONCURRENCY = 3

interface ReviewData {
  evaluation: AiEvaluation
  workId: string
  workTitle: string
  coverUrl: string | null
  currentScores: Record<string, number>
  currentEvaluation: CurrentEvaluationMeta | null
}

/** Resultado de uma avaliação disparada: pronta pra revisar, precisa de
 * confirmação (sem reviews externas), ou nada (erro/cancelada). */
type EvalOutcome =
  | { kind: "review"; data: ReviewData }
  | { kind: "needs-confirm"; work: PendingWork; noReviewsReason: NoReviewsReason | null }
  | { kind: "none" }

/**
 * Progresso ESTIMADO de uma avaliação single (a chamada do LLM é ~91% do tempo
 * e bloqueante — não há sinal real de progresso do servidor). A barra usa um
 * ease-out assintótico: avança sempre, mas nunca crava 100% antes do resultado
 * chegar (o diálogo desmonta quando chega). O rótulo de fase reflete o pipeline
 * real: busca externa rápida, depois geração das notas. É estimativa honesta,
 * não dado do modelo.
 */
function EvaluatingProgress({ estimateMs = 55000 }: { estimateMs?: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 500)
    return () => clearInterval(id)
  }, [])
  const percent = Math.min(95, 100 * (1 - Math.exp(-elapsed / (estimateMs * 0.6))))
  const phase =
    elapsed < 6000 ? "Buscando reviews externas…" : "Gerando as 9 notas com a IA…"
  return (
    <div className="space-y-2">
      <Progress value={percent} />
      <p className="text-center text-xs text-muted-foreground">{phase}</p>
    </div>
  )
}

/** Custo por obra de uma avaliação: eval (Sonnet) + resumo (Haiku) + digest (Sonnet). */
function evalCascadePerWork() {
  return previewCascade([
    { action: "ai_evaluation", label: "Avaliação dos 9 critérios" },
    { action: "review_summary", label: "Resumo de reviews" },
    { action: "review_digest", label: "Digest de reviews" },
  ])
}

export function AiEvaluationPanel({ pendingWorks, readIds = [] }: AiEvaluationPanelProps) {
  const confirmCost = useCostConfirm()
  // refresh() atualiza os contadores das abas (server component) E o chrome da
  // sidebar (badge/saldo) na mesma rota, via o evento de refresh do chrome.
  const refreshQueue = useRefresh()
  const { isRead, unmark } = useToggleRead("attr", readIds)
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const [skippingId, setSkippingId] = useState<string | null>(null)
  const [reviewData, setReviewData] = useState<ReviewData | null>(null)
  // Comparação lado a lado de dois modelos (ex.: Sonnet atual vs. Haiku reavaliado).
  const [compareData, setCompareData] = useState<{ a: ReviewData; b: ReviewData } | null>(null)
  const [queue, setQueue] = useState<PendingWork[]>([])
  const [queueResults, setQueueResults] = useState<ReviewData[]>([])
  const [queueReviewIndex, setQueueReviewIndex] = useState(0)
  const [queueProcessedCount, setQueueProcessedCount] = useState(0)
  const [queueSize, setQueueSize] = useState<number>(10)
  // Gate "sem reviews externas": confirmação antes de chamar o LLM.
  const [noReviewConfirm, setNoReviewConfirm] = useState<{
    work: PendingWork
    noReviewsReason: NoReviewsReason | null
  } | null>(null)
  // Aviso agregado do lote: obras sem reviews + as que já têm review prontas.
  const [batchNoReview, setBatchNoReview] = useState<{
    works: PendingWork[]
    reviews: ReviewData[]
  } | null>(null)
  const queueCancelledRef = useRef(false)
  // Cancela a avaliação atual (single ou item da fila). A chamada do server
  // action continua e o resultado é salvo no DB; só ignoramos o resultado no
  // cliente — usuário pode revisar depois pela página /ai-evaluation.
  const evaluationCancelledRef = useRef(false)
  const reviewScrollRef = useRef<HTMLDivElement | null>(null)
  // Obras já pré-aquecidas nesta sessão de UI — evita disparar prewarm repetido.
  const prewarmedRef = useRef(new Set<string>())

  // Fire-and-forget: aquece o cache de contexto externo da obra (TTL ~5min no
  // server) pra que triggerAiEvaluation pule a busca externa. Best-effort —
  // erros são ignorados. Deduplica por id pra não martelar os scrapers.
  const prewarm = (work: PendingWork | undefined) => {
    if (!work || prewarmedRef.current.has(work.id)) return
    prewarmedRef.current.add(work.id)
    void prewarmEvaluationContext(work.id).catch(() => {})
  }

  // Sort
  type SortField = "default" | "expected_score" | "confidence" | "evaluatedAt" | "modelName"
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [sortField2, setSortField2] = useState<SortField>("default")
  const [sortDir2, setSortDir2] = useState<"asc" | "desc">("desc")

  const sortedWorks = useMemo(() => {
    if (sortField === "default") return pendingWorks

    const getKey = (w: PendingWork, field: SortField): string | number | null => {
      switch (field) {
        case "default":
          return null
        case "expected_score":
          return w.expected_score ?? null
        case "confidence":
          return w.evaluation?.confidence ?? null
        case "evaluatedAt": {
          const v = w.evaluation?.evaluatedAt
          return v ? new Date(v).setHours(0, 0, 0, 0) : null
        }
        case "modelName":
          return w.evaluation?.modelName ?? null
      }
    }

    const compareBy = (a: PendingWork, b: PendingWork, field: SortField, dir: "asc" | "desc") => {
      const ka = getKey(a, field)
      const kb = getKey(b, field)
      // Nulos vão sempre para o fim, independente da direção.
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      const mult = dir === "asc" ? 1 : -1
      if (typeof ka === "string" && typeof kb === "string") {
        return ka.localeCompare(kb, "pt-BR") * mult
      }
      return ((ka as number) - (kb as number)) * mult
    }

    return [...pendingWorks].sort((a, b) => {
      const primary = compareBy(a, b, sortField, sortDir)
      if (primary !== 0 || sortField2 === "default") return primary
      return compareBy(a, b, sortField2, sortDir2)
    })
  }, [pendingWorks, sortField, sortDir, sortField2, sortDir2])

  const ids = useMemo(() => sortedWorks.map((w) => w.id), [sortedWorks])
  const selection = useWorkSelection(ids)

  // Normaliza o retorno (união) de triggerAiEvaluation num EvalOutcome.
  const toOutcome = (
    work: PendingWork,
    result: Awaited<ReturnType<typeof triggerAiEvaluation>>
  ): EvalOutcome => {
    if ("needsReviewConfirmation" in result && result.needsReviewConfirmation) {
      return { kind: "needs-confirm", work, noReviewsReason: result.noReviewsReason }
    }
    if ("error" in result && result.error) {
      toast.error(`Erro na avaliação de "${work.title}": ${result.error}`)
      return { kind: "none" }
    }
    if (!("data" in result) || !result.data?.evaluation) {
      toast.error(`"${work.title}": notas não retornadas.`)
      return { kind: "none" }
    }
    return {
      kind: "review",
      data: {
        evaluation: result.data.evaluation,
        workId: work.id,
        workTitle: work.title,
        coverUrl: work.cover_url ?? null,
        currentScores: result.data.currentScores ?? {},
        currentEvaluation: result.data.currentEvaluation ?? null,
      },
    }
  }

  // Queue logic
  const runEvaluation = async (
    work: PendingWork,
    opts?: { model?: "sonnet" | "opus" | "haiku"; proceedWithoutReviews?: boolean }
  ): Promise<EvalOutcome> => {
    evaluationCancelledRef.current = false
    setEvaluatingId(work.id)
    const result = await triggerAiEvaluation(work.id, opts)
    setEvaluatingId(null)

    if (evaluationCancelledRef.current) {
      evaluationCancelledRef.current = false
      return { kind: "none" }
    }
    return toOutcome(work, result)
  }

  // Variante da avaliação usada no lote (fila): NÃO mexe em `evaluatingId`
  // (que destaca uma única linha) porque rodam várias em paralelo. O progresso
  // do lote é mostrado pelo overlay da fila (queueProcessedCount).
  const runQueuedEvaluation = async (
    work: PendingWork,
    opts?: { proceedWithoutReviews?: boolean }
  ): Promise<EvalOutcome> => {
    const result = await triggerAiEvaluation(work.id, opts)
    if (queueCancelledRef.current) return { kind: "none" }
    return toOutcome(work, result)
  }

  const handleCancelEvaluation = () => {
    evaluationCancelledRef.current = true
    setEvaluatingId(null)
    toast.info(
      "Avaliação interrompida. Se a IA terminar, o resultado é salvo e fica disponível pra revisar depois."
    )
  }

  const handleEvaluate = async (work: PendingWork) => {
    const c = evalCascadePerWork()
    const ok = await confirmCost({
      estimate: { likelyUsd: c.likelyUsd, upperBoundUsd: c.upperBoundUsd, etaSeconds: c.etaSeconds, background: true, scale: 1 },
      steps: c.steps,
      title: `Avaliar "${work.title}" com IA?`,
      description: "Avaliação dos 9 critérios e, se as reviews externas mudarem, resumo + digest.",
      confirmLabel: "Avaliar",
    })
    if (!ok) return
    const outcome = await runEvaluation(work)
    if (outcome.kind === "review") setReviewData(outcome.data)
    else if (outcome.kind === "needs-confirm") {
      setNoReviewConfirm({ work, noReviewsReason: outcome.noReviewsReason })
    }
  }

  // Confirma seguir uma avaliação single mesmo sem reviews externas.
  const proceedSingleWithoutReviews = async () => {
    if (!noReviewConfirm) return
    const { work } = noReviewConfirm
    setNoReviewConfirm(null)
    const outcome = await runEvaluation(work, { proceedWithoutReviews: true })
    if (outcome.kind === "review") setReviewData(outcome.data)
  }

  // Roda um lote em PARALELO com concorrência limitada (o gargalo é o LLM,
  // ~50s cada). Mantém a ordem original e atualiza o overlay de progresso.
  // Retorna as avaliações prontas e as que precisam de confirmação (sem reviews).
  const runBatch = async (
    works: PendingWork[],
    opts?: { proceedWithoutReviews?: boolean }
  ): Promise<{
    reviews: ReviewData[]
    needConfirm: PendingWork[]
  }> => {
    setQueue(works)
    setQueueResults([])
    setQueueReviewIndex(0)
    setQueueProcessedCount(0)
    prewarmedRef.current = new Set()

    const slots: (EvalOutcome | null)[] = new Array(works.length).fill(null)
    let nextIndex = 0
    let processed = 0
    const workerCount = Math.min(QUEUE_CONCURRENCY, works.length)

    // Pré-aquece a janela inicial à frente (os próximos workerCount itens),
    // pra os primeiros slots que abrirem já acharem o contexto pronto.
    for (let i = workerCount; i < works.length && i < workerCount * 2; i += 1) {
      prewarm(works[i])
    }

    const worker = async () => {
      while (!queueCancelledRef.current) {
        const index = nextIndex
        nextIndex += 1
        if (index >= works.length) return
        // Aquece o próximo item que este worker vai pegar enquanto avalia o atual.
        prewarm(works[index + workerCount])
        const outcome = await runQueuedEvaluation(works[index], opts)
        processed += 1
        setQueueProcessedCount(processed)
        if (!queueCancelledRef.current) slots[index] = outcome
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    const reviews: ReviewData[] = []
    const needConfirm: PendingWork[] = []
    for (const o of slots) {
      if (!o) continue
      if (o.kind === "review") reviews.push(o.data)
      else if (o.kind === "needs-confirm") needConfirm.push(o.work)
    }
    return { reviews, needConfirm }
  }

  const finishQueueWithReviews = (reviews: ReviewData[]) => {
    if (reviews.length === 0) {
      setQueue([])
      setQueueProcessedCount(0)
      refreshQueue()
      return
    }
    setQueueResults(reviews)
    setQueueReviewIndex(0)
    setReviewData(reviews[0])
  }

  // "Não-silencioso": após um lote, se o Comix estava degradado/fora, avisa uma
  // vez que reviews da Comix podem ter faltado (o estado é pegajoso — TTL de
  // minutos —, então checar pós-lote ≈ durante o lote). Best-effort.
  const notifyIfComixImpaired = async () => {
    try {
      const { state } = await getComixHealthStatus()
      if (state === "down") {
        toast.warning(
          "Comix indisponível durante o lote — algumas obras podem ter sido avaliadas sem reviews da Comix.",
        )
      } else if (state === "degraded") {
        toast.warning(
          "Comix instável durante o lote — reviews da Comix podem ter faltado em algumas obras.",
        )
      }
    } catch {
      /* telemetria best-effort */
    }
  }

  const startQueue = async (works?: PendingWork[]) => {
    const source = works ?? sortedWorks.slice(0, Math.max(1, Math.min(queueSize, sortedWorks.length)))
    if (source.length === 0) return

    const n = source.length
    const per = evalCascadePerWork()
    const ok = await confirmCost({
      estimate: {
        likelyUsd: per.likelyUsd * n,
        upperBoundUsd: per.upperBoundUsd * n,
        // Rodam em paralelo (QUEUE_CONCURRENCY workers).
        etaSeconds: per.etaSeconds * Math.ceil(n / QUEUE_CONCURRENCY),
        background: true,
        scale: n,
      },
      title: `Avaliar ${n} obra${n !== 1 ? "s" : ""} da fila?`,
      description: "Cada obra: avaliação dos 9 critérios + resumo/digest de reviews. Rodam em paralelo.",
      confirmLabel: `Avaliar ${n}`,
    })
    if (!ok) return

    queueCancelledRef.current = false
    setReviewData(null)
    setBatchNoReview(null)

    const { reviews, needConfirm } = await runBatch(source)
    if (queueCancelledRef.current) return
    void notifyIfComixImpaired()

    // Algumas obras sem reviews: pausa e mostra UM aviso agregado. As que têm
    // review já ficam prontas; o usuário decide se avalia as demais mesmo assim.
    if (needConfirm.length > 0) {
      setBatchNoReview({ works: needConfirm, reviews })
      return
    }
    finishQueueWithReviews(reviews)
  }

  // "Avaliar mesmo assim" no aviso agregado: roda as sem review com
  // proceedWithoutReviews e junta ao buffer de revisão.
  const proceedBatchWithoutReviews = async () => {
    if (!batchNoReview) return
    const { works, reviews } = batchNoReview
    setBatchNoReview(null)
    const { reviews: extra } = await runBatch(works, { proceedWithoutReviews: true })
    if (queueCancelledRef.current) return
    finishQueueWithReviews([...reviews, ...extra])
  }

  // "Pular essas": revisa só as obras que tinham reviews.
  const skipBatchNoReview = () => {
    if (!batchNoReview) return
    const { reviews } = batchNoReview
    setBatchNoReview(null)
    finishQueueWithReviews(reviews)
  }

  const handleSaved = async () => {
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
      refreshQueue()
    }
  }

  const handleCancel = () => {
    queueCancelledRef.current = true
    setReviewData(null)
    setQueue([])
    setQueueResults([])
    setQueueReviewIndex(0)
    setQueueProcessedCount(0)
    setBatchNoReview(null)
    refreshQueue()
  }

  const handleSkip = async (workId: string) => {
    setSkippingId(workId)
    await skipAiEvaluation(workId)
    setSkippingId(null)
    toast.success("Obra marcada para pular avaliação IA")
    refreshQueue()
  }

  const handleEvaluateSelected = async () => {
    const works = pendingWorks.filter((w) => selection.isSelected(w.id))
    selection.clear()
    await startQueue(works)
  }

  const handleSkipSelected = async () => {
    const ids = selection.selectedIds
    selection.clear()
    for (const id of ids) {
      await skipAiEvaluation(id)
    }
    toast.success(`${ids.length} obra${ids.length !== 1 ? "s" : ""} pulada${ids.length !== 1 ? "s" : ""}`)
    refreshQueue()
  }

  const isInQueue = queue.length > 0
  const queuePosition = isInQueue && reviewData && queueResults.length > 0
    ? queueReviewIndex + 1
    : 0
  // Enquanto o aviso agregado (batchNoReview) está aberto, suprime o overlay
  // de "Avaliando em fila" e a barra de revisão.
  const isQueueEvaluating = isInQueue && queueResults.length === 0 && !batchNoReview
  const evaluatingWork = evaluatingId
    ? pendingWorks.find((work) => work.id === evaluatingId)
    : null
  const queueProgress = queue.length > 0 ? (queueProcessedCount / queue.length) * 100 : 0

  if (pendingWorks.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Sparkles className="mx-auto mb-3 h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma obra pendente de avaliação IA.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {isInQueue && !isQueueEvaluating && !batchNoReview && queueResults.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/58 px-4 py-2 text-sm shadow-sm">
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

      <Dialog
        open={Boolean(evaluatingWork) && !isQueueEvaluating}
        onOpenChange={(open) => !open && handleCancelEvaluation()}
      >
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <DialogTitle>Avaliando com IA</DialogTitle>
            <DialogDescription>
              {evaluatingWork
                ? `Avaliando "${evaluatingWork.title}".`
                : "Avaliando obra."}
            </DialogDescription>
          </DialogHeader>
          <EvaluatingProgress />
          <Button variant="outline" onClick={handleCancelEvaluation}>
            <X className="h-4 w-4 mr-1.5" />
            Cancelar
          </Button>
        </DialogContent>
      </Dialog>

      {/* Toolbar / Seleção unificados */}
      {!isInQueue && (
        <QueueToolbar
          count={selection.count}
          allSelected={selection.allSelected}
          onToggleAll={selection.toggleAll}
          onClear={selection.clear}
          selectedIds={selection.selectedIds}
          sort={
            <>
              <QueueSortSelect
                width="w-[160px]"
                value={sortField}
                onChange={(v) => setSortField(v as SortField)}
                options={[
                  { value: "default", label: "Padrão" },
                  { value: "expected_score", label: LABELS.expected_score.full },
                  { value: "confidence", label: "Confiança IA" },
                  { value: "evaluatedAt", label: "Data avaliação" },
                  { value: "modelName", label: "Modelo" },
                ]}
                dir={sortDir}
                onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                dirDisabled={sortField === "default"}
              />
              {sortField !== "default" && (
                <QueueSortSelect
                  label="depois:"
                  width="w-[140px]"
                  value={sortField2}
                  onChange={(v) => setSortField2(v as SortField)}
                  options={[
                    { value: "default", label: "Nenhum" },
                    { value: "expected_score", label: LABELS.expected_score.full, disabled: sortField === "expected_score" },
                    { value: "confidence", label: "Confiança IA", disabled: sortField === "confidence" },
                    { value: "evaluatedAt", label: "Data avaliação", disabled: sortField === "evaluatedAt" },
                    { value: "modelName", label: "Modelo", disabled: sortField === "modelName" },
                  ]}
                  dir={sortDir2}
                  onToggleDir={() => setSortDir2((d) => (d === "asc" ? "desc" : "asc"))}
                  dirDisabled={sortField2 === "default"}
                />
              )}
            </>
          }
          idleExtras={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Quantos:</span>
              <Input
                type="number"
                min={1}
                max={pendingWorks.length}
                value={queueSize}
                onChange={(e) => setQueueSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-7 w-16 text-xs"
              />
              <Button variant="outline" size="xs" onClick={() => startQueue()}>
                <ListChecks className="h-3 w-3" />
                Avaliar em fila
              </Button>
            </div>
          }
          selectedActions={
            <>
              <Button size="sm" variant="outline" onClick={handleSkipSelected} disabled={selection.count === 0}>
                <SkipForward className="mr-1 h-3.5 w-3.5" />
                Pular selecionadas
              </Button>
              <Button size="sm" onClick={handleEvaluateSelected} disabled={selection.count === 0}>
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Avaliar selecionadas ({selection.count})
              </Button>
            </>
          }
        />
      )}

      <WorkQueueGrid>
        {sortedWorks.map((work) => {
          const isPending = work.matchedFilters?.includes("pending")
          const isReview = work.matchedFilters?.includes("review-pending")
          const isLowConf = work.matchedFilters?.includes("low-confidence")
          const isOutdatedModel = work.matchedFilters?.includes("outdated-model")
          const isOutdatedReviews = work.matchedFilters?.includes("outdated-reviews")

          // 1 chip de estado, por precedência.
          const state: WorkQueueState | null = isOutdatedModel
            ? { label: "Modelo antigo", tone: "rose" }
            : isOutdatedReviews
              ? { label: "Reviews novas", tone: "orange" }
              : isLowConf
                ? { label: `Confiança ${Math.round((work.evaluation?.confidence ?? 0) * 100)}%`, tone: "amber" }
                : isReview
                  ? { label: "Aguardando revisão", tone: "sky" }
                  : isPending
                    ? { label: "Nunca avaliada pela IA", tone: "slate" }
                    : null

          const details = work.evaluation ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatEvaluatedAt(work.evaluation.evaluatedAt)}
              </span>
              {(work.evaluation.modelName || work.evaluation.promptVersion) && (
                <span className="inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  <span className="font-mono">
                    {work.evaluation.modelName ?? "?"}/{work.evaluation.promptVersion ?? "?"}
                  </span>
                </span>
              )}
            </div>
          ) : null

          const actions = (
            <>
              <Button
                size="sm"
                onClick={() => handleEvaluate(work)}
                onMouseEnter={() => prewarm(work)}
                onFocus={() => prewarm(work)}
                disabled={!!evaluatingId || !!skippingId || isInQueue}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {evaluatingId === work.id
                  ? "Avaliando..."
                  : work.evaluation
                    ? "Reavaliar"
                    : "Avaliar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(work.id)}
                disabled={!!evaluatingId || !!skippingId || isInQueue}
                title="Marcar para pular avaliação IA"
              >
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                Pular
              </Button>
            </>
          )

          return (
            <WorkQueueCard
              key={work.id}
              workId={work.id}
              title={work.title}
              coverUrl={work.cover_url}
              expectedScore={work.expected_score}
              publicationStatusId={work.publication_status_id}
              personalStatusId={work.personal_status_id}
              interest={work.synopsis_quality}
              tagCount={work.tagCount}
              reviewCount={work.reviewCount}
              state={state}
              details={details}
              showDetailsDirectly
              actions={actions}
              selectable
              selected={selection.isSelected(work.id)}
              onToggleSelect={() => selection.toggle(work.id)}
              dimmed={evaluatingId === work.id}
              read={isRead(work.id)}
              onToggleRead={() => unmark(work.id)}
            />
          )
        })}
      </WorkQueueGrid>

      {/* Review Dialog */}
      <Dialog open={reviewData != null && compareData == null} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent ref={reviewScrollRef} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisão da avaliação IA</DialogTitle>
            {reviewData && (
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={`/titles/${titleToSlug(reviewData.workTitle)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-1.5 text-xl font-semibold leading-tight text-foreground hover:text-primary hover:underline"
                  title="Abrir página da obra em nova aba"
                >
                  {reviewData.workTitle}
                  <ExternalLink className="mt-1 h-4 w-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                </Link>
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
              workTitle={reviewData.workTitle}
              coverUrl={reviewData.coverUrl}
              currentScores={reviewData.currentScores}
              currentEvaluation={reviewData.currentEvaluation}
              onReevaluate={async (model) => {
                const before = reviewData
                const pseudoWork: PendingWork = {
                  id: reviewData.workId,
                  title: reviewData.workTitle,
                  publication_status: "",
                  publication_status_id: null,
                  personal_status: "",
                  personal_status_id: null,
                  cover_url: reviewData.coverUrl,
                }
                // Reavaliar a partir do modal: a obra já está aberta, então
                // segue mesmo sem reviews (sem novo aviso).
                const outcome = await runEvaluation(pseudoWork, { model, proceedWithoutReviews: true })
                if (outcome.kind !== "review") return
                // Em vez de substituir, abre a comparação lado a lado (atual vs.
                // reavaliação). O usuário escolhe qual carregar no form editável.
                if (before) {
                  setCompareData({ a: before, b: outcome.data })
                } else {
                  setReviewData(outcome.data)
                }
              }}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Comparação lado a lado de modelos (ex.: Sonnet vs. Haiku). */}
      <Dialog open={compareData != null} onOpenChange={(open) => !open && setCompareData(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comparar modelos</DialogTitle>
            <DialogDescription>
              {compareData ? `"${compareData.a.workTitle}" — escolha qual avaliação usar.` : ""}
            </DialogDescription>
          </DialogHeader>
          {compareData && (
            <AiEvaluationCompare
              a={compareData.a.evaluation}
              b={compareData.b.evaluation}
              onPick={(which) => {
                const chosen = which === "a" ? compareData.a : compareData.b
                setReviewData(chosen)
                // Mantém coerência da navegação da fila com a escolha.
                if (queueResults.length > 0) {
                  setQueueResults((prev) => {
                    const copy = prev.slice()
                    copy[queueReviewIndex] = chosen
                    return copy
                  })
                }
                setCompareData(null)
              }}
              onClose={() => setCompareData(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Gate single: sem reviews externas, confirma antes de chamar o LLM. */}
      <ConfirmDialog
        open={noReviewConfirm != null}
        onOpenChange={(open) => !open && setNoReviewConfirm(null)}
        title="Sem reviews externas"
        description={
          noReviewConfirm
            ? `Não há reviews externas para "${noReviewConfirm.work.title}"${
                noReviewConfirm.noReviewsReason
                  ? ` (${NO_REVIEWS_REASON_LABEL[noReviewConfirm.noReviewsReason]})`
                  : ""
              }. A avaliação vai usar só sinopse, tags e gêneros. Avaliar mesmo assim?`
            : undefined
        }
        confirmText="Avaliar mesmo assim"
        cancelText="Cancelar"
        onConfirm={proceedSingleWithoutReviews}
      />

      {/* Aviso agregado do lote: obras sem reviews externas. */}
      <Dialog open={batchNoReview != null} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Obras sem reviews externas</DialogTitle>
            <DialogDescription>
              {batchNoReview && (
                <>
                  {batchNoReview.works.length} obra
                  {batchNoReview.works.length !== 1 ? "s" : ""} sem reviews externas.{" "}
                  {batchNoReview.reviews.length > 0
                    ? `${batchNoReview.reviews.length} com reviews já estão prontas pra revisar.`
                    : ""}{" "}
                  A avaliação dessas usaria só sinopse, tags e gêneros.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {batchNoReview && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
              {batchNoReview.works.map((w) => (
                <li key={w.id} className="truncate">{w.title}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={skipBatchNoReview}>
              Pular essas{batchNoReview && batchNoReview.reviews.length > 0 ? " e revisar o resto" : ""}
            </Button>
            <Button onClick={() => void proceedBatchWithoutReviews()}>
              <Sparkles className="h-3.5 w-3.5" />
              Avaliar mesmo assim
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatEvaluatedAt(iso: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

