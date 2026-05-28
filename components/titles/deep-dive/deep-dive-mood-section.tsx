"use client"

import { Sparkles } from "lucide-react"
import type { DeepDiveMoodMatch } from "@/lib/ai-recommendation/types"

interface DeepDiveMoodSectionProps {
  mood: DeepDiveMoodMatch
  userContext: string | null
}

function fitColor(fit: number): string {
  if (fit >= 0.75) return "bg-emerald-500"
  if (fit >= 0.5) return "bg-amber-500"
  return "bg-rose-500"
}

export function DeepDiveMoodSection({ mood, userContext }: DeepDiveMoodSectionProps) {
  const pct = Math.round(mood.fit * 100)
  return (
    <div className="space-y-2 rounded-lg border bg-violet-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
          <Sparkles className="h-3 w-3" />
          Mood fit
        </p>
        <span className="font-mono text-xs font-semibold text-foreground">{pct}%</span>
      </div>
      {userContext && (
        <p className="text-[11px] italic text-muted-foreground">&ldquo;{userContext}&rdquo;</p>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${fitColor(mood.fit)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">{mood.why}</p>
    </div>
  )
}
