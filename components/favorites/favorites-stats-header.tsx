import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { FavoritesSummary } from "@/server/queries/favorites"

interface FavoritesStatsHeaderProps {
  summary: FavoritesSummary
}

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground"
  if (score >= 8) return "text-emerald-600 dark:text-emerald-300"
  if (score >= 6) return "text-lime-600 dark:text-lime-300"
  if (score >= 4) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

export function FavoritesStatsHeader({ summary }: FavoritesStatsHeaderProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border bg-card/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Total
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{summary.total}</p>
        <p className="text-xs text-muted-foreground">favoritos cadastrados</p>
      </div>

      <div className="rounded-lg border bg-card/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Média Nota.Final
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold font-mono tabular-nums",
            scoreColor(summary.avgFinalScore),
          )}
        >
          {summary.avgFinalScore != null ? summary.avgFinalScore.toFixed(2) : "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.withFinalScore} obra(s) com nota
        </p>
      </div>

      <div className="rounded-lg border bg-card/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Top critérios
        </p>
        {summary.topCriteria.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Sem dados</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {summary.topCriteria.map((entry) => {
              const info = CRITERIA_INFO[entry.slug]
              return (
                <Badge
                  key={entry.slug}
                  variant="outline"
                  className="gap-1 text-[10px] font-normal"
                  title={`${info?.name ?? entry.slug} (n=${entry.n})`}
                >
                  {info?.emoji} {info?.name ?? entry.slug}
                  <span className="font-mono font-semibold tabular-nums">
                    {entry.avg.toFixed(1)}
                  </span>
                </Badge>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
