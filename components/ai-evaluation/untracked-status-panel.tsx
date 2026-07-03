"use client"

import { useMemo } from "react"
import { SynopsisInputsPopover } from "@/components/ai-evaluation/synopsis-inputs-popover"
import { WorkQueueCard } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"

export interface UntrackedWorkWithMeta {
  id: string
  title: string
  coverUrl: string | null
  coverUrls: string[]
  publicationStatusId: number | null
  personalStatusId: number | null
  synopsisQuality: string | null
  expectedScore: number | null
  tagCount: number
  reviewCount: number
}

export function UntrackedStatusPanel({ works, readIds = [] }: { works: UntrackedWorkWithMeta[]; readIds?: string[] }) {
  const ids = useMemo(() => works.map((w) => w.id), [works])
  const selection = useWorkSelection(ids)
  const { isRead, unmark } = useToggleRead("untracked", readIds)

  if (works.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
        Nenhuma obra Untracked com os filtros atuais.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Barra de seleção + ações em lote */}
      <QueueToolbar
        count={selection.count}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        selectedIds={selection.selectedIds}
        showStatusAction
      />

      <WorkQueueGrid dense>
        {works.map((w) => {
          const details = <SynopsisInputsPopover workId={w.id} />

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
              details={details}
              showDetailsDirectly
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
