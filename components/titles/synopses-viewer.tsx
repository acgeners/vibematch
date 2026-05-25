"use client"

import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
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
  /** Sinopse canônica consolidada via IA (Haiku). Quando presente vira o
   * conteúdo padrão; o usuário pode alternar pra ver as originais por fonte. */
  canonical?: string | null
  maxLines?: number
  className?: string
}

export function SynopsesViewer({ synopses, canonical, maxLines = 11, className }: SynopsesViewerProps) {
  const rawItems = useMemo(() => {
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

  const canonicalText = canonical?.trim() ?? ""
  const rawText = useMemo(() => joinSynopsesForDisplay(rawItems), [rawItems])

  const hasCanonical = canonicalText.length > 0
  const hasRaw = rawItems.length > 0

  const [showOriginals, setShowOriginals] = useState(false)

  if (!hasCanonical && !hasRaw) {
    return <p className="text-sm text-muted-foreground">Sem sinopse cadastrada.</p>
  }

  // Quando só uma fonte está disponível, sem tabs — mostra direto.
  if (!hasCanonical) {
    return (
      <ExpandableText
        text={rawText}
        maxLines={maxLines}
        className={cn("whitespace-pre-line", className)}
      />
    )
  }
  if (!hasRaw) {
    return (
      <ExpandableText
        text={canonicalText}
        maxLines={maxLines}
        className={cn("whitespace-pre-line", className)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <ExpandableText
        text={canonicalText}
        maxLines={maxLines}
        className={cn("whitespace-pre-line", className)}
      />
      <div className="pt-3 border-t border-border/30 space-y-2">
        <button
          type="button"
          onClick={() => setShowOriginals(!showOriginals)}
          className="flex items-center justify-between w-full text-left group"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80 group-hover:text-foreground transition-colors">
            Sinopses Originais ({rawItems.length})
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground/70 group-hover:text-foreground transition-transform duration-200 shrink-0",
              showOriginals && "rotate-180"
            )}
          />
        </button>
        {showOriginals && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <ExpandableText
              text={rawText}
              maxLines={maxLines}
              className={cn("whitespace-pre-line text-sm text-muted-foreground/90", className)}
            />
            <button
              type="button"
              onClick={() => setShowOriginals(false)}
              className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline block"
            >
              Ocultar originais
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
