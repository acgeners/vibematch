import type { ReactNode } from "react"
import { Info } from "lucide-react"
import {
  ACCENT_STYLES,
  COST_TIER_STYLES,
  NOTE_ACCENT,
  panelTitleOf,
} from "@/components/console/console-registry"
import type {
  ConsoleAccent,
  ConsoleChip,
  ConsoleSection,
} from "@/components/console/console-registry"
import { cn } from "@/lib/utils"

/**
 * Cabeçalho + moldura do painel ativo do console: card com trilho de accent,
 * ícone, título, chips e descrição, seguido do conteúdo. Genérico —
 * compartilhado por /settings e /preferencias.
 */
export function ConsoleSectionShell({
  section,
  children,
}: {
  section: ConsoleSection
  children: ReactNode
}) {
  const styles = ACCENT_STYLES[section.accent]
  const Icon = section.icon
  return (
    <section className="relative overflow-hidden rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5 backdrop-blur">
      <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", styles.rail)} />
      <div className="space-y-4 px-4 py-4 pl-5 sm:px-5 sm:py-5 sm:pl-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-5",
              styles.iconBg,
              styles.iconText,
              styles.ring
            )}
          >
            <Icon />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-tight text-foreground">
              {panelTitleOf(section)}
            </h2>
            {section.chips && section.chips.length > 0 && (
              <SectionChips chips={section.chips} accent={section.accent} />
            )}
            <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
          </div>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}

function SectionChips({ chips, accent }: { chips: ConsoleChip[]; accent: ConsoleAccent }) {
  const styles = ACCENT_STYLES[accent]
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {chips.map((chip, i) => {
        if (chip.kind === "cost") {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                COST_TIER_STYLES[chip.tier]
              )}
            >
              {chip.label}
            </span>
          )
        }
        if (chip.kind === "step") {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                styles.iconBg,
                styles.iconText,
                styles.ring
              )}
            >
              {chip.label}
            </span>
          )
        }
        return (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {chip.label}
          </span>
        )
      })}
    </div>
  )
}

/** Callout informativo dentro de um painel (ex.: dependência entre seções). */
export function ConsoleSectionNote({
  accent,
  children,
}: {
  accent: ConsoleAccent
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground",
        NOTE_ACCENT[accent]
      )}
    >
      <Info className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", ACCENT_STYLES[accent].iconText)} />
      <p>{children}</p>
    </div>
  )
}

/** Skeleton do painel (fallback do `<Suspense>`) — imita a moldura + o header. */
export function ConsolePanelSkeleton({ section }: { section: ConsoleSection | null }) {
  const styles = section ? ACCENT_STYLES[section.accent] : ACCENT_STYLES.slate
  const Icon = section?.icon
  return (
    <section className="relative overflow-hidden rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
      <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", styles.rail)} />
      <div className="space-y-4 px-4 py-4 pl-5 sm:px-5 sm:py-5 sm:pl-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-5",
              styles.iconBg,
              styles.iconText,
              styles.ring
            )}
          >
            {Icon ? <Icon /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-64 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-9 w-full animate-pulse rounded bg-muted/60" />
          <div className="h-9 w-3/4 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
    </section>
  )
}
