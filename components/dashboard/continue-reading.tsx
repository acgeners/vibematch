import Link from "next/link"
import { BookMarked, ArrowRight, CalendarClock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { readingProgressPercent } from "@/lib/utils"
import { formatRelativeDate, formatPredictedDate } from "@/lib/date-utils"
import type { ContinueReadingItem } from "@/server/queries/dashboard"

export function ContinueReading({ items }: { items: ContinueReadingItem[] }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookMarked className="size-4 text-emerald-500" />
          Continuar lendo
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/leitura">
            Ver tudo
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhuma obra em leitura no momento.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => {
              const pct = readingProgressPercent(item.chaptersRead, item.totalChapters)
              const predicted = formatPredictedDate(item.nextChapterPredictedAt)
              return (
                <li key={item.id} className="flex items-center gap-3">
                  <CoverImage
                    url={item.coverUrl}
                    alt={item.title}
                    className="h-14 w-10 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <WorkTitleLink
                        title={item.title}
                        workId={item.id}
                        className="line-clamp-1 text-sm font-medium hover:underline"
                      />
                      <PersonalStatusBadge statusId={item.personalStatusId} iconOnly />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${pct ?? 0}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {item.totalChapters
                          ? `${item.chaptersRead ?? 0}/${item.totalChapters}`
                          : `${item.chaptersRead ?? 0} cap`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {item.lastReadAt && (
                        <span>Última leitura: {formatRelativeDate(item.lastReadAt)}</span>
                      )}
                      {predicted && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3 text-sky-500" /> Próximo: {predicted}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
