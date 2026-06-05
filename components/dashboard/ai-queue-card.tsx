import Link from "next/link"
import { Brain, ListChecks, Sparkles, FileText, ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface AiQueueCardProps {
  /** Avaliação de atributos pendente (ai_eval_status pending + review_pending). */
  attributes: number
  /** Fila de re-rank (IA Rk desatualizado/não avaliado). */
  iaRk: number
  /** Fila de previsão de interesse por sinopse. */
  synopsis: number
}

interface QueueRow {
  label: string
  count: number
  href: string
  icon: typeof ListChecks
}

export function AiQueueCard({ attributes, iaRk, synopsis }: AiQueueCardProps) {
  const rows: QueueRow[] = [
    { label: "Atributos", count: attributes, href: "/ai-evaluation", icon: ListChecks },
    { label: "IA Rk", count: iaRk, href: "/ai-evaluation?tab=ia-rk", icon: Sparkles },
    { label: "Interesse por sinopse", count: synopsis, href: "/ai-evaluation?tab=sinopse", icon: FileText },
  ]
  const total = attributes + iaRk + synopsis

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Brain className="size-4 text-violet-500" />
          Pendentes IA
        </CardTitle>
        <span className="text-2xl font-bold tabular-nums leading-none">{total}</span>
      </CardHeader>
      <CardContent className="grid gap-1.5 sm:grid-cols-3">
        {rows.map(({ label, count, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-2.5 rounded-lg border border-border/65 bg-background/40 px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-violet-400/45 hover:bg-card hover:shadow-sm hover:shadow-violet-500/10"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/12 text-violet-500 [&_svg]:size-3.5">
              <Icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-muted-foreground">{label}</span>
              <span className="block text-lg font-bold tabular-nums leading-tight">{count}</span>
            </span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-violet-500" />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
