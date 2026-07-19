"use client"

import Link from "next/link"
import { AlertTriangle, Check, ExternalLink, ImageOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CoverImage } from "@/components/ui/cover-image"
import { cn, titleToSlug } from "@/lib/utils"
import { LABELS } from "@/lib/constants/ui-labels"
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
  const risks = ranked.risks ?? []

  return (
    <div className="flex gap-3 rounded-lg border bg-card/40 p-3 transition hover:bg-card/70">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">#{rank}</span>
        <div className="relative h-24 w-16 overflow-hidden rounded border bg-muted">
          {coverUrl ? (
            <CoverImage
              url={coverUrl}
              alt={work.title}
              className="h-full w-full object-cover"
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
            href={`/titles/${titleToSlug(work.title)}`}
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
                <p className="text-xs font-semibold">{LABELS.alignment_score.full}: {Math.round(alignment_score)}/100</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Score do Claude pra essa obra considerando seu perfil de gosto + contexto da run.
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  90+ excepcional · 70–89 forte · 50–69 moderado · 30–49 fraco · &lt;30 pouco alinhado
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {work.isAdult && <AdultBadge className="w-fit px-1.5 py-0 text-[10px]" />}

        <p className="text-xs leading-relaxed text-muted-foreground">{justification}</p>

        {(top_match_factors.length > 0 || risks.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {top_match_factors.map((factor) => (
              <Badge
                key={`pro:${factor}`}
                variant="outline"
                className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[11px] font-normal text-emerald-700 dark:text-emerald-300"
              >
                <Check className="h-3 w-3 shrink-0" />
                {factor}
              </Badge>
            ))}
            {risks.map((risk) => (
              <Badge
                key={`con:${risk}`}
                variant="outline"
                className="gap-1 border-rose-500/40 bg-rose-500/10 text-[11px] font-normal text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {risk}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
