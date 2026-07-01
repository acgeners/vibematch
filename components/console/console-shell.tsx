import { Fragment } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import { LayoutGrid } from "lucide-react"
import { ConsoleOverview } from "@/components/console/console-overview"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { ConsoleGroup, ConsoleSection } from "@/components/console/console-registry"
import { cn } from "@/lib/utils"

/**
 * Casca do padrão "console" (drill-in card-grid), compartilhada entre /settings
 * e /preferencias. Sem `?s=` → OVERVIEW (grid de cards full-width, sem 2ª barra).
 * Com `?s=` → PAINEL (children) precedido de uma TAB-STRIP compacta com TODOS os
 * tópicos no topo (ativo expandido com rótulo, inativos só ícone), pra trocar de
 * seção em 1 clique sem perder a lista de vista.
 *
 * O `children` (painel) deve vir embrulhado em `<Suspense>` pela página, e só ser
 * renderizado quando `explicit` estiver setado.
 */
export function ConsoleShell({
  groups,
  basePath,
  explicit,
  badges,
  children,
}: {
  groups: ConsoleGroup[]
  basePath: string
  /** Seção selecionada via `?s=` (null = overview). */
  explicit: string | null
  badges: Record<string, number>
  children: ReactNode
}) {
  if (!explicit) {
    return <ConsoleOverview groups={groups} basePath={basePath} badges={badges} />
  }

  return (
    <div className="space-y-3">
      <NavStrip groups={groups} basePath={basePath} active={explicit} badges={badges} />
      {children}
    </div>
  )
}

// Tab-strip: todos os tópicos, compactos, no topo. Ícone + botão "Todos" leva de
// volta ao overview. Server component (só links) → ícones sem gotcha de RSC.
function NavStrip({
  groups,
  basePath,
  active,
  badges,
}: {
  groups: ConsoleGroup[]
  basePath: string
  active: string
  badges: Record<string, number>
}) {
  // Linhas explícitas da strip (via `group.stripRow`, padrão 1) — garante o split
  // sem depender do wrap por largura. Dentro de cada linha, os grupos seguem a
  // ordem do registry, com divisor entre eles.
  const rows = [...new Set(groups.map((g) => g.stripRow ?? 1))].sort((a, b) => a - b)

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-2">
      <div className="flex flex-1 flex-col gap-2">
        {rows.map((row) => (
          <div key={row} className="flex flex-wrap items-center gap-2">
            {groups
              .filter((g) => (g.stripRow ?? 1) === row)
              .map((group, gi) => (
                <Fragment key={group.label}>
                  {gi > 0 && <span aria-hidden className="h-5 w-px shrink-0 bg-border/60" />}
                  {group.sections.map((section) => (
                    <NavChip
                      key={section.id}
                      section={section}
                      basePath={basePath}
                      active={section.id === active}
                      pending={badges[section.id] ?? 0}
                    />
                  ))}
                </Fragment>
              ))}
          </div>
        ))}
      </div>
      <Link
        href={basePath}
        aria-label="Ver todos os tópicos"
        title="Ver todos os tópicos"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-sm font-medium text-foreground shadow-sm shadow-black/5 transition-colors hover:bg-muted/60 [&_svg]:size-4"
      >
        <LayoutGrid />
        Todos
      </Link>
    </div>
  )
}

function NavChip({
  section,
  basePath,
  active,
  pending,
}: {
  section: ConsoleSection
  basePath: string
  active: boolean
  pending: number
}) {
  const styles = ACCENT_STYLES[section.accent]
  const Icon = section.icon
  return (
    <Link
      href={`${basePath}?s=${section.id}`}
      aria-current={active ? "page" : undefined}
      title={section.title}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-all",
        active
          ? cn(
              "font-semibold text-foreground ring-1 shadow-[inset_0_1px_4px_rgba(0,0,0,0.28)]",
              styles.cardBg,
              styles.cardBorder,
              styles.ring
            )
          : cn(
              "border-transparent text-muted-foreground hover:-translate-y-0.5 hover:bg-card/55 hover:text-foreground hover:shadow-md",
              styles.cardHoverBorder,
              styles.cardHoverShadow
            )
      )}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md ring-1 [&_svg]:size-4",
          styles.iconBg,
          styles.iconText,
          styles.ring
        )}
      >
        <Icon />
      </span>
      <span className="whitespace-nowrap">{section.title}</span>
      {pending > 0 && (
        <span
          aria-label={`${pending} ${pending === 1 ? "item pendente" : "itens pendentes"}`}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground ring-1 ring-white/15"
        >
          {pending > 99 ? "99+" : pending}
        </span>
      )}
    </Link>
  )
}
