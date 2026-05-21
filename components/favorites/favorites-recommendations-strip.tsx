import Link from "next/link"
import { BookOpen, ChartNoAxesCombined, ChevronRight, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RecommendationRunSummary } from "@/server/queries/recommendations"

interface FavoritesRecommendationsStripProps {
  runs: RecommendationRunSummary[]
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function alignmentColor(score: number | null): string {
  if (score == null) return ""
  if (score >= 90) return "text-emerald-600 dark:text-emerald-300"
  if (score >= 70) return "text-lime-600 dark:text-lime-300"
  if (score >= 50) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

function ModeIcon({ mode }: { mode: "next_read" | "full_analysis" }) {
  return mode === "next_read" ? (
    <BookOpen className="h-3 w-3" />
  ) : (
    <ChartNoAxesCombined className="h-3 w-3" />
  )
}

export function FavoritesRecommendationsStrip({ runs }: FavoritesRecommendationsStripProps) {
  return (
    <div className="rounded-lg border bg-card/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Recomendações IA recentes
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/recommendations">
            <Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />
            Recomendar com IA
          </Link>
        </Button>
      </div>

      {runs.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Ainda não há execuções salvas.{" "}
          <Link href="/recommendations" className="underline hover:text-foreground">
            Gere a primeira recomendação
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/recommendations/${run.id}`}
                className="group block rounded-md border bg-card/60 p-2 transition hover:bg-card"
              >
                <div className="flex items-baseline gap-1.5 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="gap-0.5 text-[9px]">
                    <ModeIcon mode={run.mode} />
                    {run.mode === "next_read" ? "leitura" : "análise"}
                  </Badge>
                  <span>{formatDate(run.createdAt)}</span>
                  {run.topAlignment != null && (
                    <span className={cn("ml-auto font-medium", alignmentColor(run.topAlignment))}>
                      top {Math.round(run.topAlignment)}
                    </span>
                  )}
                </div>
                {run.topTitles.length > 0 && (
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/90">
                    {run.topTitles.join(" · ")}
                  </p>
                )}
                <div className="mt-1 flex items-center text-[10px] text-muted-foreground transition group-hover:text-foreground">
                  ver detalhes <ChevronRight className="ml-0.5 h-3 w-3" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
