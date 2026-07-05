"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"

/**
 * Ícone ⓘ ao lado do título de um card de configuração. Ao clicar (no ícone ou no
 * próprio título, via `asChild` no page), abre um popover com a explicação longa
 * do item. Popover é portalizado (Radix) → não é cortado pelo overflow do card.
 */
export function ItemHelpPopover({
  title,
  help,
  accent,
}: {
  title: string
  help: string
  accent: SettingsAccent
}) {
  const s = ACCENT_STYLES[accent]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sobre: ${title}`}
          className={cn(
            "inline-grid size-5 shrink-0 place-items-center rounded-md border border-border/70 bg-card/60 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            s.cardHoverBorder
          )}
        >
          <Info className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={7}
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <div className="mb-1.5 flex items-center gap-2">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", s.rail)} />
          <p className="text-sm font-semibold leading-tight text-foreground">{title}</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
      </PopoverContent>
    </Popover>
  )
}
