"use client"

import { Star, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { scoreToPostReadingStars } from "@/lib/constants/post-reading-criteria"

/**
 * Fileira de 5 estrelas compartilhada pelas duas visões do piloto. `value` é a nota
 * persistida (0–10); vira estrelas cheias via `scoreToPostReadingStars`. Emite estrela
 * clicada e hover (pra régua). Quando `lockedReason` vem preenchido (ex.: o eixo "Final"
 * numa obra ainda não terminada), a fileira é substituída por um selo travado com o
 * motivo — não há mais toggle N/A manual; a aplicabilidade deriva do status.
 */
export function TasteStars({
  value,
  onStar,
  onHover,
  onLeave,
  lockedReason,
  starClass = "h-[22px] w-[22px]",
}: {
  value: number | null
  onStar: (stars: number) => void
  onHover?: (stars: number) => void
  onLeave?: () => void
  lockedReason?: string
  starClass?: string
}) {
  if (lockedReason) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-[12.5px] italic text-muted-foreground/70">
        <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        {lockedReason}
      </div>
    )
  }
  const filled = scoreToPostReadingStars(value) ?? 0
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
    </div>
  )
}
