import type { ReactNode } from "react"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Badge } from "@/components/ui/badge"
import { getScoreTextColor, type ScoreColorThresholds } from "@/components/ui/score-badge"
import { cn } from "@/lib/utils"
import type { FavoritesSummary } from "@/server/queries/favorites"

interface FavoritesStatsHeaderProps {
  summary: FavoritesSummary
  scoreThresholds: ScoreColorThresholds | null
  /**
   * Quantas obras estão sendo exibidas após os filtros. Quando informado e
   * menor que o total, o card "Total" vira "X/Y" (exibidas/cadastradas).
   */
  shownCount?: number
  /** Ações (ex.: recomendar com IA) renderizadas na mesma linha dos cards. */
  actions?: ReactNode
}

export function FavoritesStatsHeader({ summary, scoreThresholds, shownCount, actions }: FavoritesStatsHeaderProps) {
  const isFiltered = shownCount != null && shownCount !== summary.total
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border bg-card/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Total
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {isFiltered ? `${shownCount}/${summary.total}` : summary.total}
        </p>
        <p className="text-xs text-muted-foreground">
          {isFiltered ? "exibidas de cadastradas" : "favoritos cadastrados"}
        </p>
      </div>

      <div className="rounded-lg border bg-card/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Média Nota Prevista
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold font-mono tabular-nums",
            getScoreTextColor(summary.avgExpectedScore, scoreThresholds),
          )}
        >
          {summary.avgExpectedScore != null ? summary.avgExpectedScore.toFixed(2) : "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.withExpectedScore} obra(s) com nota
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
                  className="gap-1 text-[11px] font-normal"
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
      {actions && (
        <div className="flex shrink-0 flex-col gap-2 lg:w-60 [&>*]:flex-1 [&_button]:h-full [&_button]:py-2.5">
          {actions}
        </div>
      )}
    </div>
  )
}
