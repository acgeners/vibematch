"use client"

import { useMemo, useState } from "react"
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

  const [activeTab, setActiveTab] = useState<"canonical" | "raw">(
    hasCanonical ? "canonical" : "raw"
  )

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

  const showingOriginals = activeTab === "raw"
  return (
    <div className="space-y-2">
      <ExpandableText
        key={activeTab}
        text={showingOriginals ? rawText : canonicalText}
        maxLines={maxLines}
        className={cn("whitespace-pre-line", className)}
      />
      <button
        type="button"
        onClick={() => setActiveTab(showingOriginals ? "canonical" : "raw")}
        className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline"
      >
        {showingOriginals
          ? "Ocultar originais"
          : `Exibir originais (${rawItems.length})`}
      </button>
    </div>
  )
}
