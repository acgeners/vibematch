import { PieChart } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Cores sólidas por status, alinhadas à paleta dos badges (status-badge.tsx).
// Mantemos um mapa local porque os badges expõem só name/símbolo, não a cor da barra.
const PERSONAL_COLORS: Record<string, string> = {
  Reading: "bg-emerald-500",
  Started: "bg-violet-500",
  "To read": "bg-slate-400",
  Completed: "bg-blue-500",
  "On-hold": "bg-slate-500",
  Stalled: "bg-orange-500",
  Hiatus: "bg-cyan-500",
  Dropped: "bg-red-500",
}

const PUBLICATION_COLORS: Record<string, string> = {
  Ongoing: "bg-emerald-500",
  Completed: "bg-blue-500",
  Hiatus: "bg-amber-500",
  Cancelled: "bg-red-500",
  Unknown: "bg-slate-400",
}

const FALLBACK_COLOR = "bg-slate-400"

function DistributionRow({
  label,
  data,
  colors,
}: {
  label: string
  data: Record<string, number>
  colors: Record<string, string>
}) {
  const entries = Object.entries(data)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)

  if (total === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">Sem dados</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {entries.map(([name, n]) => (
          <div
            key={name}
            className={cn("h-full", colors[name] ?? FALLBACK_COLOR)}
            style={{ width: `${(n / total) * 100}%` }}
            title={`${name}: ${n}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {entries.map(([name, n]) => (
          <span key={name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", colors[name] ?? FALLBACK_COLOR)} aria-hidden />
            {name}
            <span className="font-semibold tabular-nums text-foreground">{n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function StatusDistribution({
  byPersonalStatus,
  byPublicationStatus,
}: {
  byPersonalStatus: Record<string, number>
  byPublicationStatus: Record<string, number>
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <PieChart className="size-4 text-primary" />
          Distribuição por status
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <DistributionRow label="Status pessoal" data={byPersonalStatus} colors={PERSONAL_COLORS} />
        <DistributionRow label="Status de publicação" data={byPublicationStatus} colors={PUBLICATION_COLORS} />
      </CardContent>
    </Card>
  )
}
