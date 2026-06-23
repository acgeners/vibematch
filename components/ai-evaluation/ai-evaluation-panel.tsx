"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, CalendarDays, CheckSquare, Cpu, ExternalLink, Gauge, ListChecks, Loader2, Sparkles, SkipForward, X } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation, skipAiEvaluation, prewarmEvaluationContext } from "@/server/actions/ai"
import { getComixHealthStatus } from "@/server/actions/comix-resolver"
import { useRefresh } from "@/lib/use-refresh"
import { AiEvaluationReviewForm } from "./ai-evaluation-review-form"
import { AiEvaluationCompare } from "./ai-evaluation-compare"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { ScoreBadge } from "@/components/ui/score-badge"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { titleToSlug } from "@/lib/utils"
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
  matchedFilters?: Array<"pending" | "review-pending" | "low-confidence" | "outdated-model">
  evaluation?: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
    evaluatedAt: string | null
  } | null
}

interface AiEvaluationPanelProps {
  pendingWorks: PendingWork[]
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

export function AiEvaluationPanel({ pendingWorks }: AiEvaluationPanelProps) {
  // refresh() atualiza os contadores das abas (server component) E o chrome da
  // sidebar (badge/saldo) na mesma rota, via o evento de refresh do chrome.
  const refreshQueue = useRefresh()
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

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

      {/* Toolbar */}
      {!isInQueue && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/58 p-2.5 shadow-sm">
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
                size="xs"
                onClick={handleSkipSelected}
                disabled={selected.size === 0}
              >
                <SkipForward className="h-3 w-3" />
                Pular selecionadas
              </Button>
              <Button
                size="xs"
                onClick={handleEvaluateSelected}
                disabled={selected.size === 0}
              >
                <Sparkles className="h-3 w-3" />
                Avaliar selecionadas ({selected.size})
              </Button>
              <Button variant="ghost" size="xs" onClick={toggleSelectionMode}>
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="xs" onClick={toggleSelectionMode}>
                <CheckSquare className="h-3 w-3" />
                Selecionar
              </Button>

              <span className="text-xs text-muted-foreground ml-2">Ordenar:</span>
              <Select
                value={sortField}
                onValueChange={(v) => setSortField(v as SortField)}
              >
                <SelectTrigger size="sm" className="h-7 w-[160px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Padrão</SelectItem>
                  <SelectItem value="expected_score">Nota Prevista</SelectItem>
                  <SelectItem value="confidence">Confiança IA</SelectItem>
                  <SelectItem value="evaluatedAt">Data avaliação</SelectItem>
                  <SelectItem value="modelName">Modelo</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                disabled={sortField === "default"}
                title={sortDir === "asc" ? "Crescente" : "Decrescente"}
              >
                {sortDir === "asc" ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )}
              </Button>

              {sortField !== "default" && (
                <>
                  <span className="text-xs text-muted-foreground ml-1">depois:</span>
                  <Select
                    value={sortField2}
                    onValueChange={(v) => setSortField2(v as SortField)}
                  >
                    <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Nenhum</SelectItem>
                      <SelectItem value="expected_score" disabled={sortField === "expected_score"}>Nota Prevista</SelectItem>
                      <SelectItem value="confidence" disabled={sortField === "confidence"}>Confiança IA</SelectItem>
                      <SelectItem value="evaluatedAt" disabled={sortField === "evaluatedAt"}>Data avaliação</SelectItem>
                      <SelectItem value="modelName" disabled={sortField === "modelName"}>Modelo</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    onClick={() => setSortDir2((d) => (d === "asc" ? "desc" : "asc"))}
                    disabled={sortField2 === "default"}
                    title={sortDir2 === "asc" ? "Crescente" : "Decrescente"}
                  >
                    {sortDir2 === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </Button>
                </>
              )}

              <div className="flex-1" />

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
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sortedWorks.map((work) => (
          <Card
            key={work.id}
            className={[
              "transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10",
              evaluatingId === work.id ? "opacity-60" : "",
              selectionMode ? "cursor-pointer" : "",
              selectionMode && selected.has(work.id) ? "border-primary/60 bg-primary/5" : "",
            ].filter(Boolean).join(" ")}
            onClick={selectionMode ? () => toggleItem(work.id) : undefined}
          >
            <CardContent className="py-2.5">
              <div className="flex items-center gap-3">
                {selectionMode && (
                  <Checkbox
                    checked={selected.has(work.id)}
                    onCheckedChange={() => toggleItem(work.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  />
                )}

                {/* Cover thumb (esquerda) — aspect 2:3 de manga */}
                <CoverThumb url={work.cover_url} />

                {/* Conteúdo central */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span onClick={(e) => e.stopPropagation()} className="min-w-0">
                      <WorkTitleLink
                        title={work.title}
                        workId={work.id}
                        className="text-sm font-semibold hover:underline line-clamp-2 break-words"
                      />
                    </span>
                    {work.expected_score != null && (
                      <span title="Nota Prevista" className="inline-flex shrink-0">
                        <ScoreBadge score={work.expected_score} size="sm" />
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <PublicationStatusBadge statusId={work.publication_status_id ?? null} />
                    <PersonalStatusBadge statusId={work.personal_status_id ?? null} />
                    {work.synopsis_quality && (
                      <span
                        title="Interesse na sinopse"
                        className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300"
                      >
                        {work.synopsis_quality}
                      </span>
                    )}
                    <FilterBadges
                      matchedFilters={work.matchedFilters}
                      evaluation={work.evaluation}
                    />
                  </div>

                  <EvaluationMetaLine evaluation={work.evaluation} />
                </div>

                {/* Ações (direita) — stack vertical, Reavaliar destaque */}
                {!selectionMode && (
                  <div className="flex shrink-0 flex-col items-stretch gap-2.5">
                    <Button
                      size="sm"
                      onClick={() => handleEvaluate(work)}
                      onMouseEnter={() => prewarm(work)}
                      onFocus={() => prewarm(work)}
                      disabled={!!evaluatingId || !!skippingId || isInQueue}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {evaluatingId === work.id
                        ? "Avaliando..."
                        : work.evaluation
                          ? "Reavaliar"
                          : "Avaliar"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleSkip(work.id)}
                      disabled={!!evaluatingId || !!skippingId || isInQueue}
                      title="Marcar para pular avaliação IA"
                    >
                      <SkipForward className="h-3 w-3" />
                      Pular
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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

function EvaluationMetaLine({ evaluation }: { evaluation?: PendingWork["evaluation"] }) {
  if (!evaluation) {
    return (
      <p className="text-xs italic text-muted-foreground">Nunca avaliada pela IA</p>
    )
  }
  const confidence = evaluation.confidence
  const confidenceTone =
    confidence == null
      ? ""
      : confidence >= 0.75
        ? "text-emerald-600 dark:text-emerald-300"
        : confidence >= 0.5
          ? "text-amber-600 dark:text-amber-300"
          : "text-rose-600 dark:text-rose-300"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CalendarDays className="h-3 w-3" />
        {formatEvaluatedAt(evaluation.evaluatedAt)}
      </span>
      {(evaluation.modelName || evaluation.promptVersion) && (
        <span className="inline-flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          <span className="font-mono">
            {evaluation.modelName ?? "?"}/{evaluation.promptVersion ?? "?"}
          </span>
        </span>
      )}
      {confidence != null && (
        <span
          className="inline-flex items-center gap-1"
          title="Confiança declarada pela IA"
        >
          <Gauge className="h-3 w-3" />
          <span className={`font-semibold ${confidenceTone}`}>
            {Math.round(confidence * 100)}%
          </span>
        </span>
      )}
    </div>
  )
}

function FilterBadges({
  matchedFilters,
  evaluation,
}: {
  matchedFilters?: PendingWork["matchedFilters"]
  evaluation?: PendingWork["evaluation"]
}) {
  if (!matchedFilters?.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {matchedFilters.includes("pending") && (
        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300">
          sem avaliação IA
        </span>
      )}
      {matchedFilters.includes("review-pending") && (
        <span className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-200">
          aguardando revisão
        </span>
      )}
      {matchedFilters.includes("low-confidence") && evaluation?.confidence != null && (
        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200">
          confiança {Math.round(evaluation.confidence * 100)}%
        </span>
      )}
      {matchedFilters.includes("outdated-model") && evaluation && (
        <span
          className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/12 dark:text-rose-200"
          title={`Avaliado em ${evaluation.modelName ?? "?"} / ${evaluation.promptVersion ?? "?"}`}
        >
          modelo antigo: {evaluation.modelName ?? "?"}/{evaluation.promptVersion ?? "?"}
        </span>
      )}
    </div>
  )
}
