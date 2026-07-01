"use client"

import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Ícone (ⓘ) com tooltip explicando o propósito de um grupo de configurações. */
export function GroupInfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Sobre este grupo"
            onClick={(e) => {
              // Evita alternar o <details> quando o ícone vive dentro de um <summary>.
              e.preventDefault()
              e.stopPropagation()
            }}
            className="inline-grid place-items-center rounded-full text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed normal-case tracking-normal">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
