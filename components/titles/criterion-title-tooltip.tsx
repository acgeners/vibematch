"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface CriterionTitleTooltipProps {
  name: string
  description: string
  /** Quebra o título em 2 linhas em vez de truncar — pra cards estreitos onde o nome não cabe. */
  multiline?: boolean
}

export function CriterionTitleTooltip({
  name,
  description,
  multiline = false,
}: CriterionTitleTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "text-left cursor-help text-sm font-semibold underline-offset-4 decoration-dotted hover:underline",
              multiline ? "whitespace-normal leading-tight" : "truncate",
            )}
          >
            {name}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs whitespace-pre-line text-left leading-relaxed"
        >
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
