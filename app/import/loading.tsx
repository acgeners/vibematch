import { Upload } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Skeleton } from "@/components/ui/skeleton"

export default function ImportLoading() {
  return (
    <div className="w-full max-w-5xl space-y-6">
      <Header kicker="Importação" icon={<Upload />} title="Importar obras" description="Carregando…" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-md" />
        ))}
      </div>
      <Skeleton className="h-9 w-72 rounded-lg" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}
