"use client"

import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Chip da LEGENDA de um critério: a faixa (ex.: "Faixa 7-10") + o rótulo curto da IA. É a parte fixa
 * daquela faixa, separada da justificativa específica da obra. Quando há rubrica canônica
 * (`CRITERIA_RUBRICS`), ela aparece no hover — a legenda oficial da faixa, não a paráfrase.
 *
 * "Faixa X" nunca encolhe; o rótulo trunca (min-w-0 + overflow) pra não vazar em card estreito.
 */
export function CriterionBandChip({
  band,
  label,
  rubric,
}: {
  band: string
  label: string | null
  rubric: string | null
}) {
  const chipClass =
    "inline-flex max-w-full min-w-0 items-center gap-1.5 self-start overflow-hidden rounded-md border bg-foreground/[0.04] px-2 py-[3px] text-[11px]"
  const inner = (
    <>
      <span className="shrink-0 whitespace-nowrap font-mono font-semibold tracking-tight text-foreground">
        Faixa {band}
      </span>
      {label && (
        <>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate text-muted-foreground">{label}</span>
        </>
      )}
    </>
  )

  if (!rubric) return <span className={chipClass}>{inner}</span>

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={cn(chipClass, "cursor-help text-left")}>
            {inner}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs whitespace-pre-line text-left text-xs leading-relaxed"
        >
          {rubric}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
