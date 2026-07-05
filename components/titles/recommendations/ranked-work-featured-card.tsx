"use client"

import Link from "next/link"
import { ExternalLink, ImageOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CoverImage } from "@/components/ui/cover-image"
import { cn, titleToSlug } from "@/lib/utils"
import { LABELS } from "@/lib/constants/ui-labels"
import type { RankedCandidate } from "@/lib/ai-recommendation/types"

interface RankedWorkFeaturedCardProps {
  rank: number
  ranked: RankedCandidate
  /** Trunca a justificativa (pras colunas #2/#3, mais enxutas). */
  compact?: boolean
}

function quality(score: number): { label: string; scoreClass: string; badgeClass: string } {
  if (score >= 90)
    return { label: "Match excepcional", scoreClass: "text-emerald-600 dark:text-emerald-400", badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
  if (score >= 70)
    return { label: "Match forte", scoreClass: "text-lime-600 dark:text-lime-400", badgeClass: "border-lime-500/40 bg-lime-500/10 text-lime-700 dark:text-lime-300" }
  if (score >= 50)
    return { label: "Bom match", scoreClass: "text-amber-600 dark:text-amber-400", badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
  if (score >= 30)
    return { label: "Match fraco", scoreClass: "text-orange-600 dark:text-orange-400", badgeClass: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300" }
  return { label: "Pouco alinhado", scoreClass: "text-rose-600 dark:text-rose-400", badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" }
}

// Pódio: ouro / prata / bronze pros 3 primeiros.
const RANK_STYLE: Record<number, string> = {
  1: "bg-amber-400 text-amber-950 ring-amber-300/60",
  2: "bg-blue-600 text-white ring-blue-500/40",
  3: "bg-amber-700 text-white ring-amber-600/40",
}

export function RankedWorkFeaturedCard({ rank, ranked }: RankedWorkFeaturedCardProps) {
  const { work, coverUrl, alignment_score, justification } = ranked
  const href = `/titles/${titleToSlug(work.title)}`
  const q = quality(alignment_score)

  return (
    <div
      className={cn(
        "group flex gap-4 rounded-xl border bg-card/60 p-3 shadow-sm transition hover:border-primary/40 hover:bg-card/80 hover:shadow-md",
        rank === 1 && "ring-1 ring-amber-400/40",
      )}
    >
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block w-28 shrink-0 overflow-hidden rounded-lg border bg-muted shadow-sm sm:w-32 aspect-[2/3]"
      >
        {coverUrl ? (
          <CoverImage
            url={coverUrl}
            alt={work.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-7 w-7 opacity-40" />
          </div>
        )}
        <span
          className={cn(
            "absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-md text-xs font-extrabold shadow ring-1",
            RANK_STYLE[rank] ?? "bg-card text-foreground ring-border/60",
          )}
        >
          {rank}
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-base font-extrabold leading-tight text-foreground hover:underline inline-flex items-center gap-1"
          >
            {work.title}
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          </Link>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center justify-center shrink-0 rounded-lg border border-border bg-muted/40 px-2 py-1 select-none cursor-help">
                  <span className={cn("text-base font-black leading-none tabular-nums", q.scoreClass)}>
                    {Math.round(alignment_score)}
                  </span>
                  <span className="text-[6px] font-bold uppercase tracking-wider text-muted-foreground mt-0.5">{LABELS.alignment_score.full}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[300px] space-y-1.5">
                <p className="text-xs font-semibold">{LABELS.alignment_score.full}: {Math.round(alignment_score)}/100</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  90+ excepcional · 70–89 forte · 50–69 moderado · 30–49 fraco · &lt;30 pouco alinhado
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <Badge variant="outline" className={cn("w-fit text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 select-none", q.badgeClass)}>
          {q.label}
        </Badge>

        <p className="text-xs leading-relaxed text-muted-foreground mt-0.5">
          {justification}
        </p>

        {/* Real work tags displayed at the bottom of the card */}
        {work.tags && work.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-2">
            {work.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.name}
                variant="secondary"
                className="bg-muted/50 hover:bg-muted/75 text-muted-foreground/90 text-[10px] font-normal px-2 py-0.5 select-none transition-colors border-0"
              >
                {tag.name}
              </Badge>
            ))}
            {work.tags.length > 3 && (
              <Badge
                variant="secondary"
                className="bg-muted/30 text-muted-foreground/75 text-[10px] font-normal px-1.5 py-0.5 select-none border-0"
              >
                +{work.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
