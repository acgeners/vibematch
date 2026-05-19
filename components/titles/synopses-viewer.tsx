"use client"

import { useMemo } from "react"
import { ExpandableText } from "@/components/ui/expandable-text"
import { cn } from "@/lib/utils"
import { joinSynopsesForDisplay, sortWorkSynopses } from "@/lib/work-derived"

interface SynopsisRow {
  text?: string | null
  source?: string | null
  is_primary?: boolean | null
  position?: number | null
}

interface SynopsesViewerProps {
  synopses: SynopsisRow[] | null | undefined
  maxLines?: number
  className?: string
}

export function SynopsesViewer({ synopses, maxLines = 11, className }: SynopsesViewerProps) {
  const items = useMemo(() => {
    return sortWorkSynopses(
      (synopses ?? [])
      .map((r) => ({
        text: (r.text ?? "").trim(),
        is_primary: !!r.is_primary,
        position: r.position ?? 0,
      }))
      .filter((r) => r.text.length > 0)
    )
  }, [synopses])

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem sinopse cadastrada.</p>
  }

  const text = joinSynopsesForDisplay(items)

  return (
    <ExpandableText
      text={text}
      maxLines={maxLines}
      className={cn("whitespace-pre-line", className)}
    />
  )
}
