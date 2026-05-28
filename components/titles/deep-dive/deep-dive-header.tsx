"use client"

import { cn } from "@/lib/utils"
import type { DeepDivePayload } from "@/lib/ai-recommendation/types"

interface DeepDiveHeaderProps {
  payload: DeepDivePayload
}

function matchScoreColor(score: number): string {
  if (score >= 85) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
  if (score >= 70) return "bg-lime-500/15 text-lime-700 border-lime-500/40 dark:text-lime-300"
  if (score >= 50) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  if (score >= 30) return "bg-orange-500/15 text-orange-700 border-orange-500/40 dark:text-orange-300"
  return "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return "alta"
  if (c >= 0.6) return "média"
  return "baixa"
}

export function DeepDiveHeader({ payload }: DeepDiveHeaderProps) {
  const score = Math.round(payload.match_score)
  const confidencePct = Math.round(payload.confidence * 100)
  return (
    <div className="space-y-3 rounded-lg border bg-card/40 p-4">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-lg border-2",
            matchScoreColor(payload.match_score),
          )}
        >
          <span className="text-3xl font-bold tabular-nums leading-none">{score}</span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider opacity-80">match</span>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm italic leading-relaxed text-foreground">
            &ldquo;{payload.one_liner}&rdquo;
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Confiança do modelo</span>
              <span className="font-semibold text-foreground">
                {confidencePct}% · {confidenceLabel(payload.confidence)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-violet-500/70 transition-all"
                style={{ width: `${confidencePct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
