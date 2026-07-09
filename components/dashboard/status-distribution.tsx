import { PieChart, ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Cores sólidas por status, alinhadas à paleta dos badges (status-badge.tsx).
// Mantemos um mapa local porque os badges expõem só name/símbolo, não a cor da barra.
const PERSONAL_COLORS: Record<string, string> = {
  Reading: "bg-emerald-500",
  Started: "bg-violet-500",
  "Want to Read": "bg-slate-400",
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

function StatusRow({
  name,
  count,
  total,
  max,
  colors,
}: {
  name: string
  count: number
  total: number
  max: number
  colors: Record<string, string>
}) {
  const share = Math.round((count / total) * 100)
  const barPct = max > 0 ? (count / max) * 100 : 0
  return (
    <li className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground/80" title={name}>
        {name}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", colors[name] ?? FALLBACK_COLOR)}
          style={{ width: `${Math.max(barPct, 3)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums">
        <span className="font-semibold text-foreground">{count}</span>{" "}
        <span className="text-muted-foreground">{share < 1 ? "<1%" : `${share}%`}</span>
      </span>
    </li>
  )
}

/**
 * Lista de barras ranqueada: uma linha por status (rótulo · barra · contagem · %),
 * ordenada da maior pra menor. A barra é escalada em relação à MAIOR categoria
 * (comparação de magnitude), e o `%` mostra a fatia do total. Quando há mais que
 * `collapseAfter` itens, os excedentes ficam num <details> (expande sem JS).
 */
function DistributionColumn({
  label,
  data,
  colors,
  collapseAfter,
}: {
  label: string
  data: Record<string, number>
  colors: Record<string, string>
  collapseAfter?: number
}) {
  const entries = Object.entries(data)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  const max = entries.length > 0 ? entries[0][1] : 0

  const visible = collapseAfter != null ? entries.slice(0, collapseAfter) : entries
  const hidden = collapseAfter != null ? entries.slice(collapseAfter) : []

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {total > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">{total}</span> obras
            </>
          ) : (
            "Sem dados"
          )}
        </p>
      </div>

      {total > 0 && (
        <>
          <ul className="space-y-2">
            {visible.map(([name, n]) => (
              <StatusRow key={name} name={name} count={n} total={total} max={max} colors={colors} />
            ))}
          </ul>

          {hidden.length > 0 && (
            <details className="group">
              <summary className="mt-1 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                <span className="group-open:hidden">Mostrar mais {hidden.length}</span>
                <span className="hidden group-open:inline">Mostrar menos</span>
              </summary>
              <ul className="mt-2 space-y-2">
                {hidden.map(([name, n]) => (
                  <StatusRow key={name} name={name} count={n} total={total} max={max} colors={colors} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
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
      <CardContent className="grid gap-y-8 md:grid-cols-2">
        <div className="md:pr-12">
          <DistributionColumn
            label="Status pessoal"
            data={byPersonalStatus}
            colors={PERSONAL_COLORS}
            collapseAfter={5}
          />
        </div>
        <div className="md:border-l md:border-border/60 md:pl-12">
          <DistributionColumn
            label="Status de publicação"
            data={byPublicationStatus}
            colors={PUBLICATION_COLORS}
          />
        </div>
      </CardContent>
    </Card>
  )
}
