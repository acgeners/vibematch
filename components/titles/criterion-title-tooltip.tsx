"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface CriterionTitleTooltipProps {
  name: string
  description: string
}

export function CriterionTitleTooltip({
  name,
  description,
}: CriterionTitleTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-left cursor-help text-sm font-semibold truncate underline-offset-4 decoration-dotted hover:underline"
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
