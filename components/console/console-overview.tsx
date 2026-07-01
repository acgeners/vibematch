import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { GroupInfoTooltip } from "@/components/settings/group-info-tooltip"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { ConsoleGroup, ConsoleSection } from "@/components/console/console-registry"
import { cn } from "@/lib/utils"

/**
 * Overview do console (estado sem `?s=`): grid de cards agrupado, full-width.
 * Cada card é a navegação — clicar leva a `${basePath}?s=${id}` (drill-in pro
 * painel). Server component (só links + `<details>` nativo); sem 2ª barra.
 */
export function ConsoleOverview({
  groups,
  basePath,
  badges,
}: {
  groups: ConsoleGroup[]
  basePath: string
  badges: Record<string, number>
}) {
  const primary = groups.filter((g) => !g.advanced)
  const advanced = groups.filter((g) => g.advanced)

  return (
    <div className="space-y-5">
      {primary.map((group) => (
        <section key={group.label} className="space-y-2.5">
          <GroupHeading group={group} />
          <CardGrid group={group} basePath={basePath} badges={badges} />
        </section>
      ))}

      {advanced.map((group) => (
        <details key={group.label} className="group/adv">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform group-open/adv:rotate-0" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {group.label}
            </p>
            {group.info && <GroupInfoTooltip text={group.info} />}
            {group.hint && (
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                {group.hint}
              </span>
            )}
            <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
          </summary>
          <div className="mt-3">
            <CardGrid group={group} basePath={basePath} badges={badges} />
          </div>
        </details>
      ))}
    </div>
  )
}

function GroupHeading({ group }: { group: ConsoleGroup }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {group.label}
      </p>
      {group.info && <GroupInfoTooltip text={group.info} />}
      {group.hint && (
        <span className="text-[10px] lowercase tracking-wide text-muted-foreground/60">
          {group.hint}
        </span>
      )}
      <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
    </div>
  )
}

function CardGrid({
  group,
  basePath,
  badges,
}: {
  group: ConsoleGroup
  basePath: string
  badges: Record<string, number>
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {group.sections.map((section) => (
        <ConsoleCard
          key={section.id}
          section={section}
          basePath={basePath}
          pending={badges[section.id] ?? 0}
        />
      ))}
    </div>
  )
}

function ConsoleCard({
  section,
  basePath,
  pending,
}: {
  section: ConsoleSection
  basePath: string
  pending: number
}) {
  const styles = ACCENT_STYLES[section.accent]
  const Icon = section.icon
  return (
    <Link
      href={`${basePath}?s=${section.id}`}
      className={cn(
        "group relative flex min-h-[128px] flex-col items-start gap-3 rounded-2xl border border-border/70 bg-card/55 p-4 shadow-sm shadow-black/5 transition-all",
        "hover:-translate-y-0.5 hover:shadow-md",
        styles.cardHoverBorder,
        styles.cardHoverShadow
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl ring-1 transition-transform [&_svg]:size-[22px]",
          styles.iconBg,
          styles.iconText,
          styles.ring,
          "group-hover:scale-105"
        )}
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-sm font-semibold leading-tight text-foreground">{section.title}</h2>
        <p className="text-[11px] leading-snug text-muted-foreground">{section.description}</p>
      </div>

      <ChevronRight
        aria-hidden
        className="absolute right-3 top-3 size-4 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground/70"
      />
      {pending > 0 && (
        <span
          aria-label={`${pending} ${pending === 1 ? "item pendente" : "itens pendentes"}`}
          className="absolute right-9 top-3 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-white/15"
        >
          {pending > 99 ? "99+" : pending}
        </span>
      )}
    </Link>
  )
}
