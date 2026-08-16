"use client"

import Link from "next/link"
import { ImageOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { ScoreBadge } from "@/components/ui/score-badge"
import { CoverImage } from "@/components/ui/cover-image"
import { cn, titleToSlug } from "@/lib/utils"
import type { DeepDiveSimilarItem } from "@/lib/ai-recommendation/types"

interface DeepDiveSimilarSectionProps {
  items: DeepDiveSimilarItem[]
}

const SIGNAL_LABEL = {
  positive: "Lembra obra amada",
  negative: "Lembra obra evitada",
  neutral: "Comparável",
} as const

function signalClasses(signal: DeepDiveSimilarItem["alignment_signal"]): string {
  if (signal === "positive") return "border-emerald-500/40"
  if (signal === "negative") return "border-rose-500/40"
  return "border-border/60"
}

function signalBadgeClasses(signal: DeepDiveSimilarItem["alignment_signal"]): string {
  if (signal === "positive")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (signal === "negative")
    return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  return "border-border/60 bg-muted/40 text-muted-foreground"
}

export function DeepDiveSimilarSection({ items }: DeepDiveSimilarSectionProps) {
  if (items.length === 0) return null

  return (
    <CollapsibleCard
      title="Comparado a obras suas"
      description={`${items.length} obra(s) da biblioteca com vibe parecida.`}
      defaultOpen
      contentClassName="space-y-3"
    >
      {items.map((item) => {
        const title = item.title ?? "(obra removida)"
        const cover = item.coverUrl
        return (
          <div
            key={item.work_id}
            className={cn(
              "flex gap-3 rounded-lg border-l-4 border bg-card/40 p-3 transition hover:bg-card/70",
              signalClasses(item.alignment_signal),
            )}
          >
            <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded border bg-muted">
              {cover ? (
                <CoverImage
                  url={cover}
                  alt={title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="h-4 w-4" />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                {item.title ? (
                  <Link
                    href={`/catalog/${titleToSlug(item.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-2 text-sm font-medium leading-tight hover:underline"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="line-clamp-2 text-sm font-medium leading-tight text-muted-foreground">
                    {title}
                  </span>
                )}
                <ScoreBadge score={item.user_score} size="sm" />
              </div>

              <Badge
                variant="outline"
                className={cn("w-fit text-[11px] font-normal", signalBadgeClasses(item.alignment_signal))}
              >
                {SIGNAL_LABEL[item.alignment_signal]}
              </Badge>

              <p className="text-xs leading-relaxed text-muted-foreground">
                {item.similarity_reason}
              </p>
            </div>
          </div>
        )
      })}
    </CollapsibleCard>
  )
}
