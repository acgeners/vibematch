"use client"

import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"

/**
 * Separa a fila em NOVAS (o que a aba conta) e LIDAS (silenciadas), as lidas numa
 * seção recolhida no fim.
 *
 * 🔴 Até 2026-11-16 as filas de /my-ai-scores desenhavam TODAS as obras, com as lidas
 * apagadas (`opacity-60`) e misturadas por título, enquanto o número da aba contava só
 * as novas (`works.length − lidas`). Aba "12" sobre uma lista de 40: o número e a lista
 * afirmavam coisas diferentes sobre a mesma fila. Hoje a lista aberta É o número.
 *
 * ⚠️ `visibleIds` alimenta a seleção: com as lidas recolhidas, "selecionar todas"
 * não pode pegar obra que não está na tela.
 */
export function useReadSplit<T extends { id: string }>(items: T[], isRead: (id: string) => boolean) {
  const [showRead, setShowRead] = useState(false)
  const { unread, read } = useMemo(() => {
    const unread: T[] = []
    const read: T[] = []
    for (const it of items) (isRead(it.id) ? read : unread).push(it)
    return { unread, read }
  }, [items, isRead])
  const visibleIds = useMemo(
    () => [...unread, ...(showRead ? read : [])].map((w) => w.id),
    [unread, read, showRead],
  )
  return { unread, read, showRead, toggleShowRead: () => setShowRead((v) => !v), visibleIds }
}

export function ReadQueueSections<T extends { id: string }>({
  split,
  render,
  dense,
  emptyUnread = "Nada novo nesta fila.",
  readLabel = "Lidas",
}: {
  split: ReturnType<typeof useReadSplit<T>>
  render: (item: T) => ReactNode
  dense?: boolean
  emptyUnread?: string
  readLabel?: string
}) {
  const { unread, read, showRead, toggleShowRead } = split
  return (
    <div className="space-y-3">
      {unread.length > 0 ? (
        <WorkQueueGrid dense={dense}>{unread.map(render)}</WorkQueueGrid>
      ) : (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">{emptyUnread}</p>
      )}
      {read.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={toggleShowRead}
            aria-expanded={showRead}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {showRead ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {readLabel} ({read.length})
          </button>
          {showRead && <WorkQueueGrid dense={dense}>{read.map(render)}</WorkQueueGrid>}
        </div>
      )}
    </div>
  )
}
