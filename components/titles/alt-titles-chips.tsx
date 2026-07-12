"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const VISIBLE_LIMIT = 5

interface AltTitlesChipsProps {
  /** Título principal da obra — usado só para não repeti-lo entre os chips. */
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}

export function AltTitlesChips({
  title,
  originalTitle,
  alternativeTitles,
}: AltTitlesChipsProps) {
  const [expanded, setExpanded] = useState(false)

  const mainTitle = title.trim()
  const original = originalTitle?.trim()
  const hasOriginal = Boolean(original) && original !== mainTitle

  const titles = Array.from(
    new Set(
      [hasOriginal ? original : null, ...(alternativeTitles ?? [])]
        .map((t) => t?.trim())
        .filter((t): t is string => Boolean(t) && t !== mainTitle)
    )
  )

  if (titles.length === 0) return null

  const hiddenCount = titles.length - VISIBLE_LIMIT
  const visible = expanded || hiddenCount <= 0 ? titles : titles.slice(0, VISIBLE_LIMIT)

  return (
    <div className="space-y-1.5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Títulos alternativos
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((t) => {
          const isOriginal = hasOriginal && t === original
          return (
            <Badge
              key={t}
              variant="secondary"
              title={t}
              className={cn(
                "max-w-full px-2.5 py-0.5 text-xs font-normal",
                isOriginal && "bg-primary/10 font-medium text-primary"
              )}
            >
              {isOriginal && (
                <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
              )}
              <span className="min-w-0 truncate">{t}</span>
            </Badge>
          )
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground/80 ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {expanded ? "Mostrar menos" : `+${hiddenCount}`}
          </button>
        )}
      </div>
    </div>
  )
}
