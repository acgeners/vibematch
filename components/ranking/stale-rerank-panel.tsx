"use client"

import { useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, Sparkles, SkipForward } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LABELS } from "@/lib/constants/ui-labels"
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { rerankWorksBatchAction } from "@/server/actions/recommendations"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { skipAiEvaluation } from "@/server/actions/ai"
import type { AlignmentQueueWork } from "@/server/queries/recommendations"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"

type SortField = "default" | "expected" | "alignment"

const PER_CALL_CHUNK = 10
/** Um id só pros dois botões: "em lote" e "selecionadas" nunca rodam juntos. */
const BATCH_TASK_ID = "rerank-batch"

function fmtAlignmentAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : null
}

export function StaleRerankPanel({
  works,
  readIds = [],
  isPaid = true,
}: {
  works: AlignmentQueueWork[]
  readIds?: string[]
  isPaid?: boolean
}) {
  const refresh = useRefresh()
  const { isRead, unmark } = useToggleRead("veredito", readIds)
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [queueSize, setQueueSize] = useState(10)
  const [skippingId, setSkippingId] = useState<string | null>(null)

  // O lote é a ação mais longa do app: 14,0s de mediana por chamada de ranking
  // (p90 47,9s), vezes N obras. O andamento saiu do estado LOCAL e foi pro store
  // global justamente por isso — antes, sair da página levava junto o "3/12", que
  // é a única informação que importa numa espera de minutos.
  const tasks = useAppTasks()
  const batchTask = tasks.find((t) => t.id === BATCH_TASK_ID)
  const batchRunning = batchTask?.status === "running"
  const progress = batchTask?.progress ?? null

  const runBatch = (targetIds: string[], onSettled?: () => void) => {
    if (targetIds.length === 0 || batchRunning) return
    const total = targetIds.length
    runTask({
      id: BATCH_TASK_ID,
      kind: "rerank-batch",
      label: `Veredito IA: ${total} obra${total !== 1 ? "s" : ""}`,
      run: async () => {
        let ranked = 0
        let failed = 0
        setTaskProgress(BATCH_TASK_ID, 0, total)
        for (let i = 0; i < targetIds.length; i += PER_CALL_CHUNK) {
          const chunk = targetIds.slice(i, i + PER_CALL_CHUNK)
          const result = await rerankWorksBatchAction(chunk)
          // A action devolve `{ error }` em vez de lançar; sem converter, o store
          // marcaria a falha como sucesso.
          if (result.error || !result.data) throw new Error(result.error ?? "Erro ao re-rankear.")
          ranked += result.data.ranked
          failed += result.data.failed
          setTaskProgress(BATCH_TASK_ID, Math.min(i + PER_CALL_CHUNK, total), total)
        }
        return { ranked, failed }
      },
      // Refresh nos DOIS caminhos: um lote que abortou no meio já persistiu as
      // obras dos chunks anteriores, e a tela precisa mostrá-las.
      onDone: () => {
        refresh()
        onSettled?.()
      },
      onError: () => {
        refresh()
        onSettled?.()
      },
      successToast: ({ ranked, failed }) => ({
        message:
          `${ranked} re-rankeada${ranked !== 1 ? "s" : ""}` + (failed > 0 ? ` · ${failed} falhou` : "."),
      }),
    })
  }

  const handleSkip = async (workId: string) => {
    setSkippingId(workId)
    try {
      const result = await skipAiEvaluation(workId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Obra marcada para pular avaliação/re-rank por IA.")
        refresh()
      }
    } finally {
      setSkippingId(null)
    }
  }

  const sortedWorks = useMemo(() => {
    if (sortField === "default") {
      // Desatualizados primeiro, depois não avaliados; cada grupo por título.
      return [...works].sort((a, b) => {
        const aStale = a.alignmentStale && a.alignmentScore != null ? 0 : 1
        const bStale = b.alignmentStale && b.alignmentScore != null ? 0 : 1
        if (aStale !== bStale) return aStale - bStale
        return a.title.localeCompare(b.title, "pt-BR")
      })
    }
    const key = (w: AlignmentQueueWork) =>
      sortField === "expected" ? w.expectedScore : w.alignmentScore
    const mult = sortDir === "asc" ? 1 : -1
    return [...works].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      // Nulos sempre no fim, independente da direção.
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  const ids = useMemo(() => sortedWorks.map((w) => w.id), [sortedWorks])
  const selection = useWorkSelection(ids)

  // Fatia a lista VISÍVEL (sortedWorks), não a ordem crua do servidor — senão o
  // lote processa N obras fora da tela e o topo que o usuário está olhando
  // continua "Não avaliado" (a query da fila nem tem ORDER BY).
  const handleRerankQueue = () => runBatch(sortedWorks.slice(0, queueSize).map((w) => w.id))
  const handleRerankSelected = () => runBatch(selection.selectedIds, () => selection.clear())

  if (works.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/55 p-8 text-center text-sm text-muted-foreground">
        Nenhuma obra nesse filtro. 🎉
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <QueueToolbar
        count={selection.count}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        selectedIds={selection.selectedIds}
        sort={
          <QueueSortSelect
            value={sortField}
            onChange={(v) => setSortField(v as SortField)}
            options={[
              { value: "default", label: "Padrão" },
              { value: "expected", label: "Nota prevista" },
              { value: "alignment", label: LABELS.alignment_score.full },
            ]}
            dir={sortDir}
            onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            dirDisabled={sortField === "default"}
          />
        }
        idleExtras={
          works.length > 0 && isPaid ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Quantos:</span>
              <Input
                type="number"
                min={1}
                max={works.length}
                value={queueSize}
                onChange={(e) => setQueueSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-7 w-16 text-xs"
              />
              <Button variant="outline" size="xs" onClick={handleRerankQueue} disabled={batchRunning}>
                {batchRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Calcular em lote
              </Button>
            </div>
          ) : undefined
        }
        selectedActions={
          isPaid ? (
            <Button size="sm" onClick={handleRerankSelected} disabled={batchRunning}>
              {batchRunning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {batchRunning
                ? progress
                  ? `Re-rankeando… ${progress.done}/${progress.total}`
                  : "Re-rankeando…"
                : `Calcular selecionadas (${selection.count})`}
            </Button>
          ) : undefined
        }
      />

      <WorkQueueGrid>
        {sortedWorks.map((w) => {
          const isStale = w.alignmentStale && w.alignmentScore != null
          const state: WorkQueueState | null = isStale
            ? { label: "Desatualizado", tone: "amber" }
            : w.alignmentScore == null
              ? { label: "Não avaliado", tone: "slate" }
              : null

          const headline = w.alignmentScore != null ? (
            <span>
              {LABELS.alignment_score.full}: <span className="font-bold text-foreground">{Math.round(w.alignmentScore)}</span>
            </span>
          ) : null

          const details = w.alignmentAt ? (
            <p className="text-xs text-muted-foreground mt-1">
              Última avaliação em {fmtAlignmentAt(w.alignmentAt)}
            </p>
          ) : null

          const actions = (
            <>
              <RerankAiRkButton workId={w.id} hasScore={w.alignmentScore != null} workTitle={w.title} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(w.id)}
                disabled={batchRunning || !!skippingId}
                title="Marcar para pular re-rank por IA"
              >
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                Pular
              </Button>
            </>
          )

          return (
            <WorkQueueCard
              key={w.id}
              workId={w.id}
              title={w.title}
              coverUrls={w.coverUrls}
              expectedScore={w.expectedScore}
              isAdult={w.isAdult}
              userScore={w.userScore}
              publicationStatusId={w.publicationStatusId}
              personalStatusId={w.personalStatusId}
              interest={w.synopsisQuality}
              tagCount={w.tagCount}
              reviewCount={w.reviewCount}
              headline={headline}
              state={state}
              details={details}
              showDetailsDirectly
              actions={actions}
              selectable
              selected={selection.isSelected(w.id)}
              onToggleSelect={() => selection.toggle(w.id)}
              dimmed={skippingId === w.id}
              read={isRead(w.id)}
              onToggleRead={() => unmark(w.id)}
            />
          )
        })}
      </WorkQueueGrid>
    </div>
  )
}
