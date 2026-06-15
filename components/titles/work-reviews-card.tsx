"use client"

import { useState } from "react"
import { ChevronDown, MessageSquareText, PenLine, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpandableText } from "@/components/ui/expandable-text"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"

interface WorkReviewsCardProps {
  snapshot: WorkReviewsSnapshot
}

function ratingColor(rating: number | null): string {
  if (rating == null) return "text-muted-foreground"
  if (rating >= 8) return "text-emerald-600 dark:text-emerald-300"
  if (rating >= 6) return "text-lime-600 dark:text-lime-300"
  if (rating >= 4) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

export function WorkReviewsCard({ snapshot }: WorkReviewsCardProps) {
  const [expanded, setExpanded] = useState(false)

  if (snapshot.total === 0 && snapshot.manual.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Reviews</CardTitle>
            </div>
            <Badge variant="outline" className="text-[11px]">0 reviews</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhuma review salva ainda. Reviews externas são extraídas quando a
            Avaliação IA é executada; reviews suas podem ser adicionadas na edição
            da obra.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Reviews</CardTitle>
            {snapshot.total > 0 && (
              <Badge variant="outline" className="text-[11px]">
                {snapshot.total} de {snapshot.bySource.length} fonte(s)
              </Badge>
            )}
            {snapshot.manual.length > 0 && (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <PenLine className="h-3 w-3" />
                {snapshot.manual.length} sua{snapshot.manual.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {snapshot.fetchedAt && (
              <span className="text-xs text-muted-foreground">
                buscado em {formatRelativeDateTime(snapshot.fetchedAt)}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </div>
        </button>
      </CardHeader>
      {snapshot.summary && (
        <CardContent className="pb-3 pt-0">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Resumo das reviews (IA)</span>
              {snapshot.summaryAt && (
                <span className="text-[11px] text-muted-foreground">
                  · {formatRelativeDateTime(snapshot.summaryAt)}
                </span>
              )}
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {snapshot.summary}
            </p>
          </div>
        </CardContent>
      )}
      {expanded && (
        <CardContent className="space-y-5">
          {snapshot.manual.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <PenLine className="h-3.5 w-3.5 text-primary" />
                  Suas reviews
                </h3>
                <span className="text-xs text-muted-foreground">
                  {snapshot.manual.length} review(s)
                </span>
              </div>
              <ul className="space-y-2">
                {snapshot.manual.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-md border border-primary/30 bg-primary/5 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Review manual</span>
                      {review.userRating != null && (
                        <span
                          className={cn(
                            "font-mono font-semibold tabular-nums",
                            ratingColor(review.userRating),
                          )}
                        >
                          {review.userRating.toFixed(1)}/10
                        </span>
                      )}
                    </div>
                    <ExpandableText
                      text={review.text}
                      maxLines={4}
                      className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line"
                    />
                    {review.note && (
                      <p className="mt-2 text-xs italic text-muted-foreground">
                        {review.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {snapshot.bySource.map(({ source, reviews }) => (
            <section key={source}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {PLATFORM_LABELS[source] ?? source}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {reviews.length} review(s)
                </span>
              </div>
              <ul className="space-y-2">
                {reviews.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-md border bg-card/40 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <div className="flex items-baseline gap-2">
                        {review.sourceTitle && (
                          <span
                            className="line-clamp-1 max-w-[28rem] text-muted-foreground"
                            title={review.sourceTitle}
                          >
                            <span className="text-foreground/70">como </span>“{review.sourceTitle}”
                          </span>
                        )}
                        <Badge variant="outline" className="text-[11px]">
                          match {Math.round(review.matchScore * 100)}%
                        </Badge>
                      </div>
                      {review.userRating != null && (
                        <span
                          className={cn(
                            "font-mono font-semibold tabular-nums",
                            ratingColor(review.userRating),
                          )}
                        >
                          {review.userRating.toFixed(1)}/10
                        </span>
                      )}
                    </div>
                    <ExpandableText
                      text={review.text}
                      maxLines={4}
                      className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-line"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
