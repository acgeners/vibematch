import { History } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { RecentActivityItem } from "@/server/queries/dashboard"

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-sky-500" />
          Atividade recente
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nenhuma atividade recente.</p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <CoverImage
                  url={item.coverUrl}
                  alt={item.title}
                  className="h-12 w-9 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <WorkTitleLink
                    title={item.title}
                    workId={item.id}
                    className="line-clamp-1 text-sm font-medium hover:underline"
                  />
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        item.kind === "added"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-200"
                          : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-200"
                      }
                    >
                      {item.kind === "added" ? "Adicionada" : "Atualizada"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeDateTime(item.kind === "added" ? item.createdAt : item.updatedAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
