"use client"

import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { SynopsisInputsPopover } from "@/components/ai-evaluation/synopsis-inputs-popover"
import { WorkQueueCard } from "@/components/ai-evaluation/queue/work-queue-card"
import { ReadQueueSections, useReadSplit } from "@/components/ai-evaluation/queue/read-split"
import { QueueToolbar } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"

export interface UntrackedWorkWithMeta {
  id: string
  title: string
  coverUrls: string[]
  publicationStatusId: number | null
  hiatusKind: HiatusKind | null
  hiatusKindConfidence: "high" | "low" | null
  publicationStatusNote: string | null
  personalStatusId: number | null
  synopsisQuality: string | null
  expectedScore: number | null
  tagCount: number
  reviewCount: number
  /** Chip 🔞 (works.is_adult) e badge "Real" (works_owner.user_score) — anexados na page. */
  isAdult?: boolean
  /** Obra `mixed` (versão normal + R18) — decide o selo junto com `isAdult` (`workContentBadge`). */
  isMixed?: boolean
  userScore?: number | null
}

export function UntrackedStatusPanel({ works, readIds = [] }: { works: UntrackedWorkWithMeta[]; readIds?: string[] }) {
  const { isRead, unmark } = useToggleRead("untracked", readIds)
  const split = useReadSplit(works, isRead)
  const selection = useWorkSelection(split.visibleIds)

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

      <ReadQueueSections
        split={split}
        dense
        render={(w) => {
          const details = <SynopsisInputsPopover workId={w.id} />

          return (
            <WorkQueueCard
              key={w.id}
              workId={w.id}
              title={w.title}
              coverUrls={w.coverUrls}
              expectedScore={w.expectedScore}
              isAdult={w.isAdult}
              isMixed={w.isMixed}
              userScore={w.userScore}
              publicationStatusId={w.publicationStatusId}
              hiatusKind={w.hiatusKind}
              hiatusKindConfidence={w.hiatusKindConfidence}
              publicationStatusNote={w.publicationStatusNote}
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
        }}
      />
    </div>
  )
}
