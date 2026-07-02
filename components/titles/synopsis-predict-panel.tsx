"use client"

import { useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { PredictSynopsisRowActions } from "@/components/titles/predict-synopsis-row-actions"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import { SynopsisInputsPopover } from "@/components/ai-evaluation/synopsis-inputs-popover"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { InterestBackfillButton } from "@/components/titles/interest-backfill-button"
import {
  planSynopsisInterestBatchAction,
  runSynopsisInterestBatchAction,
} from "@/server/actions/synopsis-quality"
import { cn } from "@/lib/utils"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQueueWork } from "@/server/queries/recommendations"

/** Nível ordinal do Interesse (♥=1 … ♥♥♥♥=4); 0 se desconhecido. */
function synopsisLevel(q: string | null): number {
  if (!q) return 0
  const idx = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return idx >= 0 ? idx + 1 : 0
}

/** DD/MM/AAAA a partir do ISO (slice — evita mismatch de fuso/hidratação). */
function fmtPredictedAt(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : null
}

type SortField = "default" | "expected" | "lastRead" | "predicted"

/** Uma obra "precisa de previsão" quando não tem previsão ou está desatualizada. */
function needsPrediction(w: SynopsisQueueWork): boolean {
  return w.predictedQuality == null || w.predictionStale
}

/**
 * Fila de Interesse na Obra (aba /ai-evaluation?tab=sinopse): obras com sinopse
 * canônica que precisam de estimativa (desatualizada ou não prevista). Usa o card
 * unificado `WorkQueueCard` + seleção em lote: as ações (Prever/Aplicar) agem sobre
 * as obras selecionadas; item a item continua no `PredictSynopsisRowActions`.
 */
export function SynopsisPredictPanel({ works, isPaid = true }: { works: SynopsisQueueWork[]; isPaid?: boolean }) {
  const refresh = useRefresh()
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [batchRunning, setBatchRunning] = useState(false)

  const sortedWorks = useMemo(() => {
    if (sortField === "default") {
      // Desatualizados primeiro, depois não previstos; cada grupo por título.
      return [...works].sort((a, b) => {
        const aStale = a.predictedQuality != null && a.predictionStale ? 0 : 1
        const bStale = b.predictedQuality != null && b.predictionStale ? 0 : 1
        if (aStale !== bStale) return aStale - bStale
        return a.title.localeCompare(b.title, "pt-BR")
      })
    }
    const mult = sortDir === "asc" ? 1 : -1
    if (sortField === "lastRead" || sortField === "predicted") {
      // Datas ISO comparam lexicograficamente = cronologicamente. Nulos no fim.
      const key = (w: SynopsisQueueWork) => (sortField === "lastRead" ? w.lastReadAt : w.predictedAt)
      return [...works].sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        if (ka == null && kb == null) return 0
        if (ka == null) return 1
        if (kb == null) return -1
        return ka < kb ? -1 * mult : ka > kb ? 1 * mult : 0
      })
    }
    return [...works].sort((a, b) => {
      const ka = a.expectedScore
      const kb = b.expectedScore
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  const ids = useMemo(() => sortedWorks.map((w) => w.id), [sortedWorks])
  const selection = useWorkSelection(ids)

  // Contagem da seleção pra rotular a ação em lote (Prever = a operação cara que
  // faz sentido em lote; Aplicar/Pular seguem por card, item a item).
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  const selectedPending = selection.selectedIds.filter((id) => {
    const w = byId.get(id)
    return w != null && needsPrediction(w)
  })

  // Executa o lote já confirmado. Custo total governado pelo teto (upper bound do dry-run).
  const executeBatch = async (batchIds: string[], maxCostUsd: number) => {
    setBatchRunning(true)
    try {
      const res = await runSynopsisInterestBatchAction(batchIds, { maxCostUsd })
      if (res.status === "ok") {
        const r = res.report
        toast.success(
          `${r.succeeded} estimada${r.succeeded !== 1 ? "s" : ""} · ${r.fresh} já ok` +
            (r.failed > 0 ? ` · ${r.failed} falhou` : "") +
            (r.blocked > 0 ? ` · ${r.blocked} bloqueada(s)` : "") +
            ` · custo $${r.costUsd.toFixed(3)}`,
        )
      } else if (res.status === "blocked_cost_confirmation") {
        toast.error(res.message)
      } else {
        toast.error("message" in res ? res.message : res.error)
      }
    } finally {
      setBatchRunning(false)
      selection.clear()
      refresh()
    }
  }

  // Fluxo: DRY-RUN obrigatório → mostra contagens + custo → confirmação única → execução.
  const predictSelected = async () => {
    const batchIds = selection.selectedIds
    if (batchIds.length === 0 || batchRunning) return
    setBatchRunning(true)
    try {
      const planned = await planSynopsisInterestBatchAction(batchIds)
      if (planned.status !== "ok") {
        toast.error("message" in planned ? planned.message : planned.error)
        return
      }
      const p = planned.plan
      const needCalls = p.stale + p.absent
      if (needCalls === 0) {
        toast.success("As obras selecionadas já estão atualizadas — nada a estimar.")
        return
      }
      const profileNote = p.needsProfile ? " · inclui gerar/atualizar o perfil" : ""
      const maxCostUsd = Math.max(p.upperBoundUsd, 0.01)
      toast(
        `Lote: ${needCalls} previsão(ões)${profileNote}. Custo ~$${p.likelyUsd.toFixed(3)} (provável) / até $${p.upperBoundUsd.toFixed(3)}.`,
        {
          duration: 15000,
          action: {
            label: "Executar",
            onClick: () => {
              void executeBatch(batchIds, maxCostUsd)
            },
          },
        },
      )
    } finally {
      setBatchRunning(false)
    }
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
              { value: "lastRead", label: "Última leitura" },
              { value: "predicted", label: "Data da previsão" },
            ]}
            dir={sortDir}
            onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            dirDisabled={sortField === "default"}
          />
        }
        idleExtras={isPaid ? <InterestBackfillButton works={works} isPaid={isPaid} /> : undefined}
        selectedActions={
          isPaid ? (
            <Button size="sm" onClick={predictSelected} disabled={batchRunning || selectedPending.length === 0}>
              {batchRunning ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              Prever selecionadas ({selectedPending.length})
            </Button>
          ) : undefined
        }
      />

      <WorkQueueGrid>
        {sortedWorks.map((w) => {
          const isStale = w.predictedQuality != null && w.predictionStale
          const hasBoth = w.predictedQuality != null && w.manualSynopsisQuality != null
          const alreadyApplied = w.predictedQuality != null && w.manualSynopsisQuality === w.predictedQuality
          const diverges = hasBoth && !alreadyApplied
          const delta = hasBoth ? synopsisLevel(w.predictedQuality) - synopsisLevel(w.manualSynopsisQuality) : null

          // 1 chip de estado, por precedência.
          const state: WorkQueueState | null = isStale
            ? { label: "Desatualizado", tone: "amber" }
            : w.predictedQuality == null
              ? { label: "Não previsto", tone: "slate" }
              : diverges
                ? { label: "Diverge", tone: "orange" }
                : alreadyApplied
                  ? { label: "Bate", tone: "emerald" }
                  : null

          // Destaque da aba: a sugestão da IA (linha 2).
          const headline =
            w.predictedQuality != null ? (
              <span>
                IA sugere{" "}
                <span className="font-semibold text-rose-600 dark:text-rose-300">
                  {w.predictedQuality} {SYNOPSIS_QUALITY_LABELS[w.predictedQuality] ?? ""}
                </span>
                {w.predictedConfidence != null && ` · ${Math.round(w.predictedConfidence * 100)}%`}
              </span>
            ) : null

          const details = (
            <>
              {w.justification && (
                <p className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">{w.justification}</p>
              )}
              <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {w.predictedPromptVersion ? `versão ${w.predictedPromptVersion}` : ""}
                {delta != null && (
                  <span
                    className={cn(
                      "ml-1.5 rounded px-1 py-0.5 font-semibold",
                      delta === 0
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : "bg-orange-500/12 text-orange-700 dark:text-orange-300",
                    )}
                  >
                    Δ {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
                {w.predictedAt && <span className="ml-2">· prevista em {fmtPredictedAt(w.predictedAt)}</span>}
              </p>
              <SynopsisInputsPopover
                canonicalSynopsis={w.canonicalSynopsis}
                tags={w.tags}
                reviewDigest={w.reviewDigest}
              />
            </>
          )

          const actions = (
            <>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Interesse</span>
                <SynopsisQualityPicker workId={w.id} value={w.manualSynopsisQuality} />
              </div>
              <PredictSynopsisRowActions
                workId={w.id}
                hasPrediction={w.predictedQuality != null}
                alreadyApplied={alreadyApplied}
                isPaid={isPaid}
              />
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
            />
          )
        })}
      </WorkQueueGrid>
    </div>
  )
}
