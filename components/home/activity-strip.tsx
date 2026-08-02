import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ActivityItem {
  value: number | string
  label: string
  href: string
  /** Destaca o número — reservado ao que pede ação hoje (capítulo novo). */
  accent?: boolean
}

/**
 * O resumo de ATIVIDADE da home — quatro números e um link para o painel.
 *
 * Deliberadamente diferente dos StatCards que moravam aqui: aqueles misturavam atividade
 * (acompanhando, avaliadas) com operação (custo de IA em 30 dias, pendências de avaliação), e
 * era essa mistura que fazia a primeira tela parecer console. Aqui entra só o que descreve a
 * leitura de quem olha; custo, filas e saúde do sistema vivem em `/painel`.
 *
 * Uma faixa, não cartões: a vitrine abaixo é que deve carregar o peso visual.
 */
export function ActivityStrip({ items }: { items: ActivityItem[] }) {
  return (
    <section
      aria-label="Seu resumo"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3 shadow-sm"
    >
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-6">
          {i > 0 && <span aria-hidden className="hidden h-8 w-px bg-border/70 sm:block" />}
          <Link
            href={item.href}
            className="group flex items-baseline gap-2 rounded-md transition-colors"
          >
            <span
              className={cn(
                "font-mono text-lg font-bold tabular-nums tracking-tight",
                item.accent ? "text-primary" : "text-foreground",
              )}
            >
              {item.value}
            </span>
            <span className="text-xs text-muted-foreground group-hover:text-foreground">
              {item.label}
            </span>
          </Link>
        </div>
      ))}

      <Link
        href="/painel"
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        Painel completo
        <ArrowRight className="size-3" />
      </Link>
    </section>
  )
}
