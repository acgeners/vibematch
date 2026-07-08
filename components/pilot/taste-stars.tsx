"use client"

import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { scoreToPostReadingStars } from "@/lib/constants/post-reading-criteria"
import type { TasteCriterion } from "@/server/queries/pilot-taste"

/**
 * Fileira de 5 estrelas (+ N/A quando o critério permite) compartilhada pelas duas
 * visões do piloto. `value` é a nota persistida (0–10); vira estrelas cheias via
 * `scoreToPostReadingStars`. Emite estrela clicada, N/A e hover (pra régua).
 */
export function TasteStars({
  crit,
  value,
  na,
  onStar,
  onNa,
  onHover,
  onLeave,
  starClass = "h-[22px] w-[22px]",
}: {
  crit: TasteCriterion
  value: number | null
  na: boolean
  onStar: (stars: number) => void
  onNa?: () => void
  onHover?: (stars: number) => void
  onLeave?: () => void
  starClass?: string
}) {
  const filled = na ? 0 : (scoreToPostReadingStars(value) ?? 0)
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={onLeave}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} de 5`}
          onClick={(e) => {
            e.stopPropagation()
            onStar(i)
          }}
          onMouseEnter={() => onHover?.(i)}
          className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <Star
            className={cn(
              "transition-transform hover:scale-110",
              starClass,
              i <= filled
                ? "fill-rose-500 text-rose-500"
                : "fill-transparent text-rose-300/60 dark:text-rose-100/15",
            )}
          />
        </button>
      ))}
      {crit.allowsNa && onNa && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNa()
          }}
          className={cn(
            "ml-2 rounded-full border px-2.5 py-1 text-[11px] tracking-wide transition-colors",
            na
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-muted-foreground",
          )}
        >
          N/A
        </button>
      )}
    </div>
  )
}
