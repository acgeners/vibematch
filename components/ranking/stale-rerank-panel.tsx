"use client"

import { useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, Sparkles, SkipForward } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { rerankWorksBatchAction } from "@/server/actions/recommendations"
import { skipAiEvaluation } from "@/server/actions/ai"
import type { AlignmentQueueWork } from "@/server/queries/recommendations"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"

type SortField = "default" | "expected" | "alignment"

const PER_CALL_CHUNK = 10

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
  const [batchRunning, setBatchRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [queueSize, setQueueSize] = useState(10)
  const [skippingId, setSkippingId] = useState<string | null>(null)

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

  const handleRerankQueue = async () => {
    const targetIds = works.slice(0, queueSize).map((w) => w.id)
    if (targetIds.length === 0 || batchRunning) return
    const total = targetIds.length
    setBatchRunning(true)
    setProgress({ done: 0, total })
    let ranked = 0
    let failed = 0
    let aborted = false
    try {
      for (let i = 0; i < targetIds.length; i += PER_CALL_CHUNK) {
        const chunk = targetIds.slice(i, i + PER_CALL_CHUNK)
        const result = await rerankWorksBatchAction(chunk)
        if (result.error || !result.data) {
          toast.error(result.error ?? "Erro ao re-rankear.")
          aborted = true
          break
        }
        ranked += result.data.ranked
        failed += result.data.failed
        setProgress({ done: Math.min(i + PER_CALL_CHUNK, total), total })
      }
    } finally {
      setBatchRunning(false)
      setProgress(null)
    }
    if (!aborted) {
      toast.success(
        `${ranked} re-rankeada${ranked !== 1 ? "s" : ""} com sucesso` +
          (failed > 0 ? ` · ${failed} falhou` : "."),
      )
    }
    refresh()
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

  const handleRerankSelected = async () => {
    const selectedIds = selection.selectedIds
    if (selectedIds.length === 0 || batchRunning) return
    const total = selectedIds.length
    setBatchRunning(true)
    setProgress({ done: 0, total })
    let ranked = 0
    let failed = 0
    let aborted = false
    try {
      for (let i = 0; i < selectedIds.length; i += PER_CALL_CHUNK) {
        const chunk = selectedIds.slice(i, i + PER_CALL_CHUNK)
        const result = await rerankWorksBatchAction(chunk)
        if (result.error || !result.data) {
          toast.error(result.error ?? "Erro ao re-rankear.")
          aborted = true
          break
        }
        ranked += result.data.ranked
        failed += result.data.failed
        setProgress({ done: Math.min(i + PER_CALL_CHUNK, total), total })
      }
    } finally {
      setBatchRunning(false)
      setProgress(null)
      selection.clear()
    }
    if (!aborted) {
      toast.success(
        `${ranked} re-rankeada${ranked !== 1 ? "s" : ""}` +
          (failed > 0 ? ` · ${failed} falhou` : "."),
      )
    }
    refresh()
  }

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
              { value: "alignment", label: "Veredito IA" },
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
              Veredito IA: <span className="font-bold text-foreground">{Math.round(w.alignmentScore)}</span>
            </span>
          ) : null

          const details = w.alignmentAt ? (
            <p className="text-xs text-muted-foreground mt-1">
              Última avaliação em {fmtAlignmentAt(w.alignmentAt)}
            </p>
          ) : null

          const actions = (
            <>
              <RerankAiRkButton workId={w.id} hasScore={w.alignmentScore != null} />
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
