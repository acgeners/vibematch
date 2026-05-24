"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface ScoreLabelTooltipProps {
  name: string
  description: string
}

export function ScoreLabelTooltip({ name, description }: ScoreLabelTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground cursor-help underline-offset-4 decoration-dotted hover:underline"
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
