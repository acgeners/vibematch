"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CalendarDays, ClipboardCheck, Cpu, ExternalLink, Gauge, ListChecks, Loader2, Sparkles, SkipForward, X } from "lucide-react"
import { toast } from "sonner"
import {
  triggerAiEvaluation,
  skipAiEvaluation,
  prewarmEvaluationContext,
  loadAiEvaluationForReview,
} from "@/server/actions/ai"
import { prepareAndEvaluate } from "@/server/actions/prepare-and-evaluate"
import type { PrepSummary } from "@/server/actions/prepare-and-evaluate"
import type { EvalPrep, MainReviewSource } from "@/lib/ai-evaluation/eval-readiness"
import { getComixHealthStatus } from "@/server/actions/comix-resolver"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { previewCascade } from "@/lib/cost-preview/catalog"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"
import { AiEvaluationReviewForm } from "./ai-evaluation-review-form"
import type { CurrentEvaluationMeta } from "./ai-evaluation-review-form"
import { confidenceTextClass } from "@/lib/ai-evaluation/confidence-tone"
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
  is_adult?: boolean
  user_score?: number | null
  tagCount?: number | null
  reviewCount?: number | null
  matchedFilters?: Array<"pending" | "review-pending" | "low-confidence" | "outdated-model" | "outdated-reviews">
  /**
   * `works.ai_eval_status`. É daqui que sai o "Revisar" — ver o comentário do
   * `WorkRow` em `app/curation/works/page.tsx`: `matchedFilters` responde "por que
   * ela apareceu", que é outra pergunta e depende de quais filtros estão ligados.
   */
  aiEvalStatus?: string | null
  /** O que falta preparar antes de avaliar. Ausente = a aba não hidratou (trata como
   *  "nada a preparar", que degrada pro botão "Avaliar" de sempre). */
  prep?: EvalPrep | null
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
  /** Faltou fonte principal — a avaliação NÃO rodou e nada foi gasto. */
  | { kind: "blocked"; work: PendingWork; missingSources: MainReviewSource[] }
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

/**
 * Custo por obra com o preparo — a mesma cascata acima MAIS a inferência de tags.
 *
 * 🔴 O acréscimo é só `infer_tags` (0,99¢ medido em 603 chamadas), e é isso que faz
 * "Preparar e avaliar" ser o caminho padrão em vez de um modo caro: a aquisição de
 * reviews é scraping (US$0) e cai no cache de 5 min que a avaliação consulta logo
 * depois, e resumo/digest **já estavam nesta lista** porque a avaliação sozinha já os
 * dispara ao persistir reviews novas.
 */
function prepareCascadePerWork() {
  return previewCascade([
    { action: "infer_tags", label: "Inferir tags com as reviews novas" },
    { action: "ai_evaluation", label: "Avaliação dos 9 critérios" },
    { action: "review_summary", label: "Resumo de reviews" },
    { action: "review_digest", label: "Digest de reviews" },
  ])
}

const SOURCE_LABEL: Record<MainReviewSource, string> = { comix: "Comix", mangago: "Mangago" }

/** "Comix" · "Comix e Mangago" — a frase que o chip e o aviso usam, num lugar só. */
function listMissingSources(sources: readonly MainReviewSource[]): string {
  const nomes = sources.map((s) => SOURCE_LABEL[s] ?? s)
  if (nomes.length <= 1) return nomes.join("")
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`
}

/** A obra precisa de preparo antes de avaliar? `prep` ausente ⇒ não (degrada pro fluxo antigo). */
function needsPrep(work: PendingWork): boolean {
  return Boolean(work.prep && (work.prep.blocked || work.prep.needsTagRefresh))
}

export function AiEvaluationPanel({ pendingWorks, readIds = [] }: AiEvaluationPanelProps) {
  const confirmCost = useCostConfirm()
  // refresh() atualiza os contadores das abas (server component) E o chrome da
  // sidebar (badge/saldo) na mesma rota, via o evento de refresh do chrome.
  const refreshQueue = useRefresh()
  const { isRead, unmark } = useToggleRead("attr", readIds)
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const [skippingId, setSkippingId] = useState<string | null>(null)
  /** Só a leitura da avaliação existente ("Revisar") — separado de `evaluatingId`,
   *  que destaca e escurece a linha porque ali algo está sendo GERADO. */
  const [loadingReviewId, setLoadingReviewId] = useState<string | null>(null)
  const [reviewData, setReviewData] = useState<ReviewData | null>(null)
  // Guarda o fechamento acidental do popup de revisão (clique fora / Esc / X): descartar aqui
  // cancela a fila inteira de revisão, então confirma antes.
  const [confirmDiscardReview, setConfirmDiscardReview] = useState(false)
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
  // Obras que o gate de fontes recusou — aviso agregado, com o destino que resolve.
  const [blockedWorks, setBlockedWorks] = useState<
    { work: PendingWork; missingSources: MainReviewSource[] }[]
  >([])
  // O que o preparo fez em cada obra do lote — vira UMA frase no fim, não N toasts.
  const prepLogRef = useRef<PrepSummary[]>([])
  const queueCancelledRef = useRef(false)
  // Cancela a avaliação atual (single ou item da fila). A chamada do server
  // action continua e o resultado é salvo no DB; só ignoramos o resultado no
  // cliente — usuário pode revisar depois pela página /curation/works.
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

  /**
   * A bifurcação preparar × avaliar, num lugar só — os três caminhos (obra, fila,
   * reavaliar-com-modelo) passam por aqui.
   *
   * ⚠️ `prepare` NÃO é oferecido na reavaliação por modelo (o modal de comparação):
   * ali a pergunta é "o que OUTRO modelo diz sobre a MESMA entrada", e mexer nas tags
   * no meio trocaria a entrada — a comparação deixaria de comparar.
   */
  const callEvaluate = async (
    work: PendingWork,
    opts: {
      model?: "sonnet" | "opus" | "haiku"
      proceedWithoutReviews?: boolean
      prepare?: boolean
    } = {},
  ): Promise<EvalOutcome> => {
    if (!opts.prepare) {
      return toOutcome(work, await triggerAiEvaluation(work.id, opts))
    }
    const res = await prepareAndEvaluate(work.id, {
      proceedWithoutReviews: opts.proceedWithoutReviews,
    })
    if (res.kind === "blocked_sources") {
      return { kind: "blocked", work, missingSources: res.missingSources }
    }
    if (res.kind === "error") {
      toast.error(`Erro ao preparar "${work.title}": ${res.error}`)
      return { kind: "none" }
    }
    prepLogRef.current.push(res.prep)
    return toOutcome(work, res.result)
  }

  // Queue logic
  const runEvaluation = async (
    work: PendingWork,
    opts?: { model?: "sonnet" | "opus" | "haiku"; proceedWithoutReviews?: boolean; prepare?: boolean }
  ): Promise<EvalOutcome> => {
    evaluationCancelledRef.current = false
    setEvaluatingId(work.id)
    const outcome = await callEvaluate(work, opts)
    setEvaluatingId(null)

    if (evaluationCancelledRef.current) {
      evaluationCancelledRef.current = false
      return { kind: "none" }
    }
    return outcome
  }

  // Variante da avaliação usada no lote (fila): NÃO mexe em `evaluatingId`
  // (que destaca uma única linha) porque rodam várias em paralelo. O progresso
  // do lote é mostrado pelo overlay da fila (queueProcessedCount).
  const runQueuedEvaluation = async (
    work: PendingWork,
    opts?: { proceedWithoutReviews?: boolean; prepare?: boolean }
  ): Promise<EvalOutcome> => {
    const outcome = await callEvaluate(work, opts)
    if (queueCancelledRef.current) return { kind: "none" }
    return outcome
  }

  const handleCancelEvaluation = () => {
    evaluationCancelledRef.current = true
    setEvaluatingId(null)
    toast.info(
      "Avaliação interrompida. Se a IA terminar, o resultado é salvo e fica disponível pra revisar depois."
    )
  }

  const handleEvaluate = async (work: PendingWork, opts: { prepare?: boolean } = {}) => {
    const prepare = Boolean(opts.prepare)

    // 🔴 Falta fonte principal e o CLIENTE já sabe ⇒ nem pede autorização de gasto.
    // Sem isto o fluxo era: popup pedindo ~9,4¢ → você confirma → o servidor barra e
    // não gasta nada. Pedir para autorizar um gasto que não vai acontecer é o jeito
    // mais rápido de ensinar a clicar "ok" sem ler — e é justamente esse popup que
    // precisa ser levado a sério no botão ao lado.
    //
    // ⚠️ Isto NÃO substitui o gate do servidor, duplica-o: a prontidão aqui é a foto do
    // load da página, e um vínculo pode ter entrado desde então (o resolve do Comix/
    // Mangago roda em background). Quem decide de verdade é `prepareAndEvaluate`; aqui
    // só evitamos o popup inútil no caso que já é conhecido.
    if (prepare && work.prep?.blocked) {
      setBlockedWorks([{ work, missingSources: work.prep.missingSources }])
      return
    }

    const c = prepare ? prepareCascadePerWork() : evalCascadePerWork()
    const ok = await confirmCost({
      estimate: { likelyUsd: c.likelyUsd, upperBoundUsd: c.upperBoundUsd, etaSeconds: c.etaSeconds, background: true, scale: 1 },
      steps: c.steps,
      title: prepare ? `Preparar e avaliar "${work.title}"?` : `Avaliar "${work.title}" com IA?`,
      description: prepare
        ? "Busca reviews novas, regera o digest se elas mudaram, reinfere as tags com esse contexto e só então avalia os 9 critérios."
        : "Avaliação dos 9 critérios e, se as reviews externas mudarem, resumo + digest.",
      confirmLabel: prepare ? "Preparar e avaliar" : "Avaliar",
    })
    if (!ok) return
    prepLogRef.current = []
    const outcome = await runEvaluation(work, { prepare })
    if (outcome.kind === "review") {
      setReviewData(outcome.data)
      notifyPrepDone()
    } else if (outcome.kind === "needs-confirm") {
      setNoReviewConfirm({ work, noReviewsReason: outcome.noReviewsReason })
    } else if (outcome.kind === "blocked") {
      setBlockedWorks([{ work: outcome.work, missingSources: outcome.missingSources }])
    }
  }

  /**
   * UMA frase sobre o que o preparo fez, no fim — nunca um toast por passo.
   * Silencioso quando não houve preparo (o caminho "Avaliar" puro).
   */
  const notifyPrepDone = () => {
    const log = prepLogRef.current
    prepLogRef.current = []
    if (log.length === 0) return
    const reviews = log.reduce((s, p) => s + p.reviews, 0)
    const comTags = log.filter((p) => p.tagsAdded != null)
    const tagsAdded = comTags.reduce((s, p) => s + (p.tagsAdded ?? 0), 0)
    const partes = [`${reviews} review(s) conferida(s)`]
    // "reinferiu em N obras" e "somou T tags" são fatos diferentes: reinferir e achar
    // zero tags novas é resultado legítimo, e some se só o total for impresso.
    partes.push(
      comTags.length === 0
        ? "tags já estavam em dia"
        : `tags reinferidas em ${comTags.length} obra(s) (+${tagsAdded})`,
    )
    toast.info(`Preparo: ${partes.join(" · ")}`)
  }

  /**
   * Abre o modal com a avaliação QUE JÁ EXISTE. Sem LLM, sem custo — por isso não
   * passa pelo `confirmCost`: pedir confirmação de gasto para uma leitura ensina a
   * clicar "ok" sem ler, e é justamente esse popup que precisa ser levado a sério
   * no botão ao lado.
   */
  const handleReview = async (work: PendingWork) => {
    setLoadingReviewId(work.id)
    const result = await loadAiEvaluationForReview(work.id)
    setLoadingReviewId(null)
    if ("error" in result && result.error) {
      toast.error(`Não deu pra abrir a revisão de "${work.title}": ${result.error}`)
      return
    }
    if (!("data" in result) || !result.data) return
    setReviewData({
      evaluation: result.data.evaluation,
      workId: work.id,
      workTitle: work.title,
      coverUrl: work.cover_url ?? null,
      currentScores: result.data.currentScores ?? {},
      currentEvaluation: result.data.currentEvaluation ?? null,
    })
  }

  // Confirma seguir uma avaliação single mesmo sem reviews externas.
  const proceedSingleWithoutReviews = async () => {
    if (!noReviewConfirm) return
    const { work } = noReviewConfirm
    setNoReviewConfirm(null)
    // Sem `prepare`: o preparo JÁ rodou na 1ª tentativa (foi ele que trouxe as reviews
    // e as tags); o que o gate barrou foi só a avaliação. Repeti-lo pagaria de novo.
    const outcome = await runEvaluation(work, { proceedWithoutReviews: true })
    if (outcome.kind === "review") {
      setReviewData(outcome.data)
      notifyPrepDone()
    }
  }

  // Roda um lote em PARALELO com concorrência limitada (o gargalo é o LLM,
  // ~50s cada). Mantém a ordem original e atualiza o overlay de progresso.
  // Retorna as avaliações prontas e as que precisam de confirmação (sem reviews).
  const runBatch = async (
    works: PendingWork[],
    opts?: { proceedWithoutReviews?: boolean; prepare?: boolean }
  ): Promise<{
    reviews: ReviewData[]
    needConfirm: PendingWork[]
    blocked: { work: PendingWork; missingSources: MainReviewSource[] }[]
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
    const blocked: { work: PendingWork; missingSources: MainReviewSource[] }[] = []
    for (const o of slots) {
      if (!o) continue
      if (o.kind === "review") reviews.push(o.data)
      else if (o.kind === "needs-confirm") needConfirm.push(o.work)
      else if (o.kind === "blocked") blocked.push({ work: o.work, missingSources: o.missingSources })
    }
    return { reviews, needConfirm, blocked }
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

  const startQueue = async (works?: PendingWork[], opts: { prepare?: boolean } = {}) => {
    const source = works ?? sortedWorks.slice(0, Math.max(1, Math.min(queueSize, sortedWorks.length)))
    if (source.length === 0) return

    const n = source.length
    const prepare = Boolean(opts.prepare)
    // 🔴 O CUSTO do lote é medido pelas obras que de fato vão preparar, não pelo modo.
    // Cobrar o preparo de todas quando só metade precisa infla o número que a pessoa usa
    // pra decidir — e um teto inflado ensina a ignorar o popup, que é o oposto do que ele
    // existe pra fazer. `needsPrep` é a MESMA régua do rótulo do botão e do chip do card.
    const aPreparar = prepare ? source.filter(needsPrep).length : 0
    const per = evalCascadePerWork()
    const extra = previewCascade([{ action: "infer_tags", label: "Inferir tags com as reviews novas" }])
    const ok = await confirmCost({
      estimate: {
        likelyUsd: per.likelyUsd * n + extra.likelyUsd * aPreparar,
        upperBoundUsd: per.upperBoundUsd * n + extra.upperBoundUsd * aPreparar,
        // Rodam em paralelo (QUEUE_CONCURRENCY workers).
        etaSeconds: (per.etaSeconds + (aPreparar > 0 ? extra.etaSeconds : 0)) * Math.ceil(n / QUEUE_CONCURRENCY),
        background: true,
        scale: n,
      },
      title: prepare
        ? `Preparar e avaliar ${n} obra${n !== 1 ? "s" : ""} da fila?`
        : `Avaliar ${n} obra${n !== 1 ? "s" : ""} da fila?`,
      description: prepare
        ? `Cada obra: reviews novas + digest, depois avaliação dos 9 critérios. ${aPreparar} de ${n} também reinferem as tags. Rodam em paralelo.`
        : "Cada obra: avaliação dos 9 critérios + resumo/digest de reviews. Rodam em paralelo.",
      confirmLabel: prepare ? `Preparar e avaliar ${n}` : `Avaliar ${n}`,
    })
    if (!ok) return

    queueCancelledRef.current = false
    setReviewData(null)
    setBatchNoReview(null)
    setBlockedWorks([])
    prepLogRef.current = []

    const { reviews, needConfirm, blocked } = await runBatch(source, { prepare })
    if (queueCancelledRef.current) return
    void notifyIfComixImpaired()
    if (blocked.length > 0) setBlockedWorks(blocked)

    // Algumas obras sem reviews: pausa e mostra UM aviso agregado. As que têm
    // review já ficam prontas; o usuário decide se avalia as demais mesmo assim.
    if (needConfirm.length > 0) {
      setBatchNoReview({ works: needConfirm, reviews })
      return
    }
    notifyPrepDone()
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
    notifyPrepDone()
    finishQueueWithReviews([...reviews, ...extra])
  }

  // "Pular essas": revisa só as obras que tinham reviews.
  const skipBatchNoReview = () => {
    if (!batchNoReview) return
    const { reviews } = batchNoReview
    setBatchNoReview(null)
    notifyPrepDone()
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

  const handleEvaluateSelected = async (opts: { prepare?: boolean } = {}) => {
    const works = pendingWorks.filter((w) => selection.isSelected(w.id))
    selection.clear()
    await startQueue(works, opts)
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
              {/* 🔴 A fila PREPARA por padrão: medido em 2026-08-19, só 6,7% das obras
                  desta fila estão prontas pra avaliar sem preparo. O botão que não prepara
                  é que é a exceção — e por isso ele fica em `ghost`, não escondido: reavaliar
                  sem mexer em nada é legítimo quando se quer só a régua nova do prompt. */}
              <Button variant="outline" size="xs" onClick={() => startQueue(undefined, { prepare: true })}>
                <ListChecks className="h-3 w-3" />
                Preparar e avaliar em fila
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => startQueue()}
                title="Avalia com os dados como estão — sem buscar reviews nem reinferir tags"
              >
                Só avaliar
              </Button>
            </div>
          }
          selectedActions={
            <>
              <Button size="sm" variant="outline" onClick={handleSkipSelected} disabled={selection.count === 0}>
                <SkipForward className="mr-1 h-3.5 w-3.5" />
                Pular selecionadas
              </Button>
              <Button size="sm" onClick={() => handleEvaluateSelected({ prepare: true })} disabled={selection.count === 0}>
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Preparar e avaliar ({selection.count})
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

          const prep = work.prep ?? null
          const blockedBySources = Boolean(prep?.blocked)

          // 1 chip de estado, por precedência.
          //
          // 🔴 "Sem <fonte>" vem PRIMEIRO porque é o único que diz que a ação não roda —
          // os outros descrevem por que a obra está na fila, e este descreve por que ela
          // não sai. Ele é raro (19,9% da fila) e acionável, que é a régua pra virar chip;
          // "tags desatualizadas" é 76% e por isso NÃO é chip nenhum — vive no rótulo do
          // botão, que é onde a informação vira decisão.
          const state: WorkQueueState | null = blockedBySources
            ? { label: `Sem ${listMissingSources(prep!.missingSources)}`, tone: "rose" }
            : isOutdatedModel
            ? { label: "Modelo antigo", tone: "rose" }
            : isOutdatedReviews
              ? { label: "Reviews novas", tone: "orange" }
              // ⚠️ Sem o número: ele agora vive na linha de procedência, para TODA obra
              // avaliada. Repeti-lo aqui poria a mesma confiança em dois lugares do mesmo
              // card — e a versão que sobrasse num futuro ajuste seria sorte, não escolha.
              : isLowConf
                ? { label: "Confiança baixa", tone: "amber" }
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
              {/* 🔴 Confiança: sumiu do card em 73a9510, quando as ações viraram pilha
                  vertical e a `ConfidencePill` foi apagada sem substituto. Ficou visível
                  só dentro do chip de confiança baixa — ou seja, some justamente na obra
                  que está esperando revisão, que é quando o número decide se dá pra
                  aceitar a nota. E o seletor "Ordenar" seguiu oferecendo "Confiança IA":
                  dava pra ordenar por um número que o card não mostrava.
                  Aqui, e não num chip: data, modelo/prompt e confiança são três fatos
                  sobre a MESMA avaliação. */}
              {work.evaluation.confidence != null && (
                <span
                  className={`inline-flex items-center gap-1 ${confidenceTextClass(work.evaluation.confidence)}`}
                  title="Confiança declarada pela IA nesta avaliação"
                >
                  <Gauge className="h-3 w-3" />
                  {Math.round(work.evaluation.confidence * 100)}%
                </span>
              )}
            </div>
          ) : null

          // 🔴 Sai do ESTADO da obra, não de `matchedFilters`: uma obra em
          // review_pending que apareça pelo filtro de confiança baixa vem com
          // matchedFilters=["low-confidence"], e o botão sumiria justamente de
          // quem está esperando revisão.
          const awaitsReview = work.aiEvalStatus === "review_pending"
          const busy = !!evaluatingId || !!skippingId || isInQueue

          const actions = (
            <>
              {/* A avaliação JÁ existe: este botão só a abre, e é a ação que o chip
                  "Aguardando revisão" nomeia. Primário porque é o que a fila pede —
                  deixar a ação PAGA em destaque aqui convida a repagar o que está
                  pronto. Ver `loadAiEvaluationForReview`. */}
              {awaitsReview && (
                <Button
                  size="sm"
                  onClick={() => handleReview(work)}
                  disabled={busy || loadingReviewId === work.id}
                >
                  {loadingReviewId === work.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                  )}
                  {loadingReviewId === work.id ? "Abrindo..." : "Revisar"}
                </Button>
              )}
              {/* 🔴 O rótulo segue a PRONTIDÃO, não o modo: prometer "Avaliar" numa obra
                  cujas tags são anteriores às reviews é o que fazia abrir obra por obra
                  antes. `needsPrep` é a mesma régua do custo do lote — dois rótulos pro
                  mesmo fato divergiriam na primeira mudança. */}
              <Button
                size="sm"
                variant={awaitsReview ? "outline" : "default"}
                // `whitespace-normal` + `h-auto`: o `buttonVariants` traz `whitespace-nowrap`
                // e `h-8` fixos, e "Preparar e avaliar" (164,2px) não cabe nos 144 do trilho.
                // Quebrar sai MAIS BARATO que alargar — ver o tier medido em `WorkQueueCard`.
                className="h-auto min-h-8 whitespace-normal py-1.5 leading-tight"
                onClick={() => handleEvaluate(work, { prepare: needsPrep(work) })}
                onMouseEnter={() => prewarm(work)}
                onFocus={() => prewarm(work)}
                disabled={busy}
                title={
                  blockedBySources
                    ? `Sem vínculo com ${listMissingSources(prep!.missingSources)} — essas duas fontes carregam 78% das reviews do catálogo. Resolva o vínculo antes de avaliar.`
                    : prep?.needsTagRefresh
                      ? "Busca reviews novas, regera o digest se mudaram, reinfere as tags com esse contexto e só então avalia"
                      : "Avalia os 9 critérios com os dados atuais"
                }
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {evaluatingId === work.id
                  ? "Avaliando..."
                  : needsPrep(work)
                    ? "Preparar e avaliar"
                    : work.evaluation
                      ? "Reavaliar"
                      : "Avaliar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(work.id)}
                disabled={busy}
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
              isAdult={work.is_adult}
              userScore={work.user_score}
              publicationStatusId={work.publication_status_id}
              personalStatusId={work.personal_status_id}
              interest={work.synopsis_quality}
              tagCount={work.tagCount}
              reviewCount={work.reviewCount}
              state={state}
              details={details}
              showDetailsDirectly
              actions={actions}
              // "Preparar e avaliar" pede 164,2px — ver o tier medido em `WorkQueueCard`.
              // Sem isto o rótulo é cortado, e o corte não aparece em canal nenhum.
              wideActions
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
      <Dialog
        open={reviewData != null && compareData == null}
        onOpenChange={(open) => {
          // X/Esc/clique-fora confirma antes de descartar (cancela a fila). Salvar/Cancelar
          // chamam handleSaved/handleCancel direto e passam por fora deste guard.
          if (!open) setConfirmDiscardReview(true)
        }}
      >
        <DialogContent ref={reviewScrollRef} className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisão da avaliação IA</DialogTitle>
            {reviewData && (
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={`/catalog/${titleToSlug(reviewData.workTitle)}`}
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
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscardReview}
        onOpenChange={setConfirmDiscardReview}
        title="Descartar a avaliação?"
        description="Você perderá o resultado da IA que ainda não foi aplicado. Ele continua pendente e pode ser revisado depois."
        confirmText="Descartar"
        cancelText="Continuar revisando"
        onConfirm={handleCancel}
      />

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

      {/*
        Obras que o gate de fontes recusou. NÃO é o mesmo diálogo do "sem reviews": ali a
        obra foi avaliada com o que havia; aqui ela NÃO foi avaliada e nada foi gasto.

        ⚠️ Sem "avaliar mesmo assim". O gate existe porque mangago e comix carregam 78% das
        reviews do catálogo — um escape a um clique de distância vira o caminho normal, e a
        nota entra no catálogo compartilhado com um quinto da evidência, sem nada acusar
        depois. O destino que resolve é a aba Fontes, e ela já sabe fazer isso (vincular ou
        declarar ausente, que também destrava).
      */}
      <Dialog open={blockedWorks.length > 0} onOpenChange={(open) => !open && setBlockedWorks([])}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {blockedWorks.length} obra{blockedWorks.length !== 1 ? "s" : ""} sem fonte principal
            </DialogTitle>
            <DialogDescription>
              Não {blockedWorks.length !== 1 ? "foram avaliadas" : "foi avaliada"} e nada foi
              gasto. Comix e Mangago carregam <strong>78%</strong> das reviews do catálogo —
              avaliar sem elas usaria um quinto da evidência. Resolva o vínculo (ou declare que
              a obra não existe na fonte) na aba Fontes.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
            {blockedWorks.map(({ work, missingSources }) => (
              <li key={work.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{work.title}</span>
                <span className="shrink-0 text-rose-500">
                  sem {listMissingSources(missingSources)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setBlockedWorks([])}>
              Fechar
            </Button>
            <Button asChild>
              <Link href="/curation/works?tab=fontes">
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir a aba Fontes
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

