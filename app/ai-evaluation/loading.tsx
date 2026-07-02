import { Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Skeleton da fila de /ai-evaluation — espelha o layout real: header + tab-strip
 * (5 abas) + card de filtro + toolbar de seleção + grid 2-col de WorkQueueCard
 * (capa 96×144 à esquerda, título/meta/estado à direita, nota no canto).
 */
export default function AiEvaluationLoading() {
  return (
    <div className="space-y-4">
      <Header
        kicker="Avaliação"
        title="Avaliação IA"
        description="Fila de avaliação/revisão das notas por IA (atributos) e de re-rank (Veredito IA) desatualizado ou não avaliado."
        icon={<Sparkles />}
      />

      {/* Tab bar — 5 abas */}
      <div className="flex items-center gap-1 border-b border-border/60">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="-mb-px px-3 py-2">
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>

      {/* Card de filtro */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-36" />
        </CardContent>
      </Card>

      {/* Toolbar de seleção */}
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/58 p-2.5 shadow-sm">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-28" />
        <div className="mx-1 h-4 w-px bg-border/80" />
        <Skeleton className="h-7 w-[150px]" />
      </div>

      {/* Grid 2-col de cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3.5">
              <div className="flex items-start gap-4">
                <Skeleton className="h-36 w-24 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
                  <Skeleton className="h-5 w-3/4" />
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                  <Skeleton className="h-6 w-28 rounded-full" />
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 self-center">
                  <Skeleton className="h-8 w-28" />
                  <Skeleton className="h-8 w-28" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
