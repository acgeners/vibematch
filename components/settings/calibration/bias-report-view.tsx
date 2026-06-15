import { Badge } from "@/components/ui/badge"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import type { BiasReport } from "@/lib/ai-calibration/types"

interface BiasReportViewProps {
  report: BiasReport
  createdAt: string
}

function dispersionColor(d: "low" | "medium" | "high"): string {
  if (d === "high") return "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
  if (d === "medium") return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
}

function biasBar(estimate: number, width = 21): string {
  const range = 5
  const clamped = Math.max(-range, Math.min(range, estimate))
  const center = Math.floor(width / 2)
  const pos = center + Math.round((clamped / range) * center)
  const cells = Array.from({ length: width }, (_, i) => {
    if (i === pos) return "●"
    if (i === center) return "│"
    return "─"
  })
  return cells.join("")
}

export function BiasReportView({ report, createdAt }: BiasReportViewProps) {
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Gerado em {new Date(createdAt).toLocaleString("pt-BR")}
      </div>

      {report.summary && (
        <p className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
          {report.summary}
        </p>
      )}

      <div className="space-y-2">
        {report.entries.map((entry) => {
          const info = CRITERIA_INFO[entry.criterion_slug]
          return (
            <div key={entry.criterion_slug} className="rounded-lg border bg-card/40 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {info?.emoji} {info?.name ?? entry.criterion_slug}
                </span>
                <Badge variant="outline" className={cn("text-[11px]", dispersionColor(entry.dispersion))}>
                  dispersão {entry.dispersion}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  conf {(entry.confidence * 100).toFixed(0)}%
                </span>
                <span className="ml-auto font-mono tabular-nums text-foreground/80">
                  bias {entry.bias_estimate > 0 ? "+" : ""}
                  {entry.bias_estimate.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                <span className="mr-2">-5</span>
                <span>{biasBar(entry.bias_estimate)}</span>
                <span className="ml-2">+5</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                {entry.recommendation}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
