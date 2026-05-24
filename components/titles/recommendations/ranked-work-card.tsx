"use client"

import Link from "next/link"
import { ExternalLink, ImageOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { cn } from "@/lib/utils"
import type { RankedCandidate } from "@/lib/ai-recommendation/types"

interface RankedWorkCardProps {
  rank: number
  ranked: RankedCandidate
}

function alignmentColor(score: number): string {
  if (score >= 90) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
  if (score >= 70) return "bg-lime-500/15 text-lime-700 border-lime-500/40 dark:text-lime-300"
  if (score >= 50) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  if (score >= 30) return "bg-orange-500/15 text-orange-700 border-orange-500/40 dark:text-orange-300"
  return "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
}

export function RankedWorkCard({ rank, ranked }: RankedWorkCardProps) {
  const { work, coverUrl, alignment_score, justification, top_match_factors } = ranked

  return (
    <div className="flex gap-3 rounded-lg border bg-card/40 p-3 transition hover:bg-card/70">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">#{rank}</span>
        <div className="relative h-24 w-16 overflow-hidden rounded border bg-muted">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getCoverImageSrc(coverUrl)}
              alt={work.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-4 w-4" />
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/titles/${work.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm font-medium leading-tight hover:underline"
          >
            {work.title}
            <ExternalLink className="ml-1 inline h-3 w-3 text-muted-foreground" />
          </Link>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "shrink-0 cursor-help rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums",
                    alignmentColor(alignment_score),
                  )}
                >
                  {Math.round(alignment_score)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[320px] space-y-1.5">
                <p className="text-xs font-semibold">IA Re-rank: {Math.round(alignment_score)}/100</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Score do Claude pra essa obra considerando seu perfil de gosto + contexto da run.
                </p>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  90+ excepcional · 70–89 forte · 50–69 moderado · 30–49 fraco · &lt;30 pouco alinhado
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{justification}</p>

        {top_match_factors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {top_match_factors.map((factor) => (
              <Badge key={factor} variant="outline" className="text-[10px] font-normal">
                {factor}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
