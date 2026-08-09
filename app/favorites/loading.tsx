import { Heart } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Skeleton } from "@/components/ui/skeleton"

export default function FavoritesLoading() {
  return (
    <div className="space-y-4">
      <Header title="Favoritos" description="Carregando…" icon={<Heart />} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
