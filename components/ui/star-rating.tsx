"use client"

import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface StarRatingProps {
  value: number | null | undefined
  onChange?: (value: number | null) => void
  valueForStars: (stars: number) => number
  starsForValue: (value: number | null | undefined) => number | null
  id?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  size?: "sm" | "md"
  showValue?: boolean
  starDescriptions?: Array<string | undefined>
}

export function StarRating({
  value,
  onChange,
  valueForStars,
  starsForValue,
  id,
  disabled = false,
  readOnly = false,
  className,
  size = "md",
  showValue = true,
  starDescriptions,
}: StarRatingProps) {
  const selectedStars = starsForValue(value)
  const canEdit = !disabled && !readOnly && onChange
  const starClass = size === "sm" ? "text-lg" : "text-2xl"

  return (
    <div className={cn("flex items-center gap-2", className)} id={id}>
      <div className="flex items-center gap-0.5" role={canEdit ? "radiogroup" : "img"} aria-label="Avaliação por estrelas">
        {[1, 2, 3, 4, 5].map((stars) => {
          const active = selectedStars != null && stars <= selectedStars
          const score = valueForStars(stars)
          const description = starDescriptions?.[stars - 1]
          return (
            <TooltipProvider key={stars}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role={canEdit ? "radio" : undefined}
                    aria-checked={canEdit ? selectedStars === stars : undefined}
                    aria-label={`${stars} estrela${stars === 1 ? "" : "s"}: ${score}`}
                    disabled={!canEdit}
                    onClick={() => {
                      if (!canEdit) return
                      onChange(selectedStars === stars ? null : score)
                    }}
                    className={cn(
                      "rounded-sm leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      starClass,
                      active ? "text-amber-500" : "text-muted-foreground/30",
                      canEdit && "cursor-pointer hover:text-amber-400",
                      !canEdit && "cursor-default"
                    )}
                  >
                    ★
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
                  <span className="font-semibold text-background">{"★".repeat(stars)}</span>
                  <span className="ml-1 opacity-80">= {score}</span>
                  {description && <p className="mt-1 leading-snug">{description}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
      </div>
      {showValue && (
        <span className="min-w-8 text-sm font-medium text-muted-foreground">
          {value == null ? "—" : value}
        </span>
      )}
    </div>
  )
}
