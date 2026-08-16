import { Header } from "@/components/layout/header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function TitlesLoading() {
  return (
    <div className="space-y-4">
      <Header title="Títulos" description="Carregando catálogo…" />

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3 flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border last:border-b-0 px-4 py-3 flex items-center gap-4"
            >
              <Skeleton className="h-10 w-10 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
