import Link from "next/link"
import { BookMarked, ArrowRight, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CoverImage } from "@/components/ui/cover-image"
import { AdultBadge } from "@/components/ui/adult-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { formatRelativeDate } from "@/lib/date-utils"
import type { ContinueReadingItem } from "@/server/queries/dashboard"

export function ContinueReading({
  items,
  following,
  followingWithPending,
}: {
  items: ContinueReadingItem[]
  /** Total de obras acompanhadas (Reading/Started). Exibido no subtítulo. */
  following?: number
  /** Quantas têm capítulos pendentes. Exibido no subtítulo. */
  followingWithPending?: number
}) {
  const subtitle = [
    following != null ? `${following} obras` : null,
    followingWithPending ? `${followingWithPending} com pendências` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex min-w-0 items-baseline gap-2 text-base">
          <BookMarked className="size-4 shrink-0 self-center text-emerald-500" />
          Acompanhando
          {subtitle && (
            <span className="truncate text-xs font-normal text-muted-foreground">· {subtitle}</span>
          )}
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-foreground">
          <Link href="/reading">
            Ver tudo
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Tudo em dia — nenhuma obra acompanhada com capítulos pendentes.
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const hasPending = item.pending != null && item.pending > 0
              return (
                <li key={item.id} className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-muted/40">
                  <CoverImage
                    urls={item.coverUrls}
                    alt={item.title}
                    className="h-11 w-8 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.isAdult && <AdultBadge className="shrink-0 px-1.5 py-0 text-[10px]" />}
                      <WorkTitleLink
                        title={item.title}
                        workId={item.id}
                        className="line-clamp-1 min-w-0 text-sm font-medium hover:underline"
                      />
                    </div>
                    {item.lastReadAt && (
                      <span className="text-[11px] text-muted-foreground">
                        Última leitura: {formatRelativeDate(item.lastReadAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end leading-tight">
                    <span className="text-xs font-medium tabular-nums text-foreground/80">
                      {item.totalChapters
                        ? `${item.chaptersRead ?? 0}/${item.totalChapters}`
                        : `${item.chaptersRead ?? 0}`}
                      <span className="font-normal text-muted-foreground"> caps</span>
                    </span>
                    {hasPending && (
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        {item.pending} pendente{item.pending === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {item.comixUrl && (
                    <a
                      href={item.comixUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-all hover:-translate-y-0.5 hover:bg-primary/18"
                      title="Ler no Comix (abre em nova aba)"
                    >
                      <ExternalLink className="size-3.5" />
                      Ler
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
