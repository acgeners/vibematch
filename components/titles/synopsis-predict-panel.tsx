"use client"

import { useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"
import { Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PredictSynopsisRowActions } from "@/components/titles/predict-synopsis-row-actions"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import { SynopsisInputsPopover } from "@/components/ai-evaluation/synopsis-inputs-popover"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { InterestBackfillButton } from "@/components/titles/interest-backfill-button"
import { useBatchAiActions, INTEREST_TASK_ID } from "@/components/titles/use-batch-ai-actions"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
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

const BATCH_TASK_ID = INTEREST_TASK_ID

type SortField = "default" | "expected" | "lastRead" | "predicted"

/** Uma obra "precisa de previsão" quando não tem previsão ou está desatualizada. */
function needsPrediction(w: SynopsisQueueWork): boolean {
  return w.predictedQuality == null || w.predictionStale
}

/**
 * Fila de Interesse na Obra (aba /fila-recomendacao?tab=sinopse): obras com sinopse
 * canônica que precisam de estimativa (desatualizada ou não prevista). Usa o card
 * unificado `WorkQueueCard` + seleção em lote: as ações (Prever/Aplicar) agem sobre
 * as obras selecionadas; item a item continua no `PredictSynopsisRowActions`.
 */
export function SynopsisPredictPanel({ works, readIds = [], isPaid = true }: { works: SynopsisQueueWork[]; readIds?: string[]; isPaid?: boolean }) {
  const refresh = useRefresh()
  const { isRead, unmark } = useToggleRead("interesse", readIds)
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const tasks = useAppTasks()
  const taskRunning = tasks.some((t) => t.id === BATCH_TASK_ID && t.status === "running")

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

  // O dry-run → popup de custo → execução mora em `useBatchAiActions`, o MESMO
  // caminho que a seleção do /ranking usa. Uma 2ª cópia divergiria justo nos dois
  // detalhes silenciosos: o `throw` que transforma `status !== "ok"` em falha (sem
  // ele o indicador diz "pronto" pra um lote bloqueado por custo) e o teto
  // `upperBoundUsd` que governa o gasto autorizado.
  const batchAi = useBatchAiActions({
    onSettled: () => {
      selection.clear()
      refresh()
    },
  })

  // O dry-run + modal de custo ficam ANCORADOS (é decisão, exige a pessoa aqui);
  // só a execução vira tarefa global. Daí os dois sinais somados no `batchRunning`.
  const batchRunning = taskRunning || batchAi.planning

  const predictSelected = () => {
    if (batchRunning) return
    void batchAi.predictInterest(selection.selectedIds)
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
              <SynopsisInputsPopover workId={w.id} />
            </>
          )

          // Rating manual do usuário — pareado com a sugestão da IA na coluna de
          // info (slot `rating` do card), fora do trilho de ações.
          const rating = (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Seu interesse
              </span>
              <SynopsisQualityPicker workId={w.id} value={w.manualSynopsisQuality} />
            </>
          )

          // Trilho direito — só ações (Prever/Aplicar/Pular + gate).
          const actions = (
            <PredictSynopsisRowActions
              workId={w.id}
              hasPrediction={w.predictedQuality != null}
              // O MESMO `isStale` que pinta o chip "Desatualizado" do card: chip e
              // rótulo do botão têm que sair do mesmo fato, senão um diz "desatualizado"
              // enquanto o outro convida a "prever de novo".
              stale={isStale}
              alreadyApplied={alreadyApplied}
              readiness={w.readiness}
              isPaid={isPaid}
            />
          )

          return (
            <WorkQueueCard
              key={w.id}
              // ⚠️ Medido no browser em 2026-08-15: com o trilho padrão (`w-28`, 112px)
              // o botão "Atualizar previsão" pede 128px — o ✨ saía PRA FORA da pílula
              // e o "ã" vazava pela borda. `wideActions` dá 144px, com folga de 16.
              // O rótulo tem dono único, então encurtá-lo aqui reabriria a divergência
              // de vocabulário que ele existe pra fechar.
              wideActions
              workId={w.id}
              title={w.title}
              coverUrls={w.coverUrls}
              expectedScore={w.expectedScore}
              isAdult={w.isAdult}
              userScore={w.userScore}
              publicationStatusId={w.publicationStatusId}
              personalStatusId={w.personalStatusId}
              tagCount={w.tagCount}
              reviewCount={w.reviewCount}
              headline={headline}
              state={state}
              rating={rating}
              details={details}
              showDetailsDirectly
              actions={actions}
              selectable
              selected={selection.isSelected(w.id)}
              onToggleSelect={() => selection.toggle(w.id)}
              read={isRead(w.id)}
              onToggleRead={() => unmark(w.id)}
            />
          )
        })}
      </WorkQueueGrid>
    </div>
  )
}
