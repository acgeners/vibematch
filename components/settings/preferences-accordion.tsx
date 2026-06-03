"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export type PreferencesAccent =
  | "primary"
  | "amber"
  | "rose"
  | "violet"
  | "emerald"
  | "cyan"

export interface PreferencesSection {
  id: string
  title: string
  description: string
  icon: ReactNode
  accent: PreferencesAccent
  content: ReactNode
}

interface AccentStyle {
  rail: string
  cardActiveBg: string
  cardActiveBorder: string
  cardHoverBorder: string
  iconBg: string
  iconText: string
  ring: string
}

const ACCENT_STYLES: Record<PreferencesAccent, AccentStyle> = {
  primary: {
    rail: "bg-gradient-to-b from-primary/80 to-primary/30",
    cardActiveBg: "bg-primary/10",
    cardActiveBorder: "border-primary/60",
    cardHoverBorder: "hover:border-primary/45",
    iconBg: "bg-primary/20",
    iconText: "text-primary",
    ring: "ring-primary/30",
  },
  amber: {
    rail: "bg-gradient-to-b from-amber-500/80 to-amber-500/30",
    cardActiveBg: "bg-amber-500/10",
    cardActiveBorder: "border-amber-500/60",
    cardHoverBorder: "hover:border-amber-500/45",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/30",
  },
  rose: {
    rail: "bg-gradient-to-b from-rose-500/80 to-rose-500/30",
    cardActiveBg: "bg-rose-500/10",
    cardActiveBorder: "border-rose-500/60",
    cardHoverBorder: "hover:border-rose-500/45",
    iconBg: "bg-rose-500/20",
    iconText: "text-rose-600 dark:text-rose-300",
    ring: "ring-rose-500/30",
  },
  violet: {
    rail: "bg-gradient-to-b from-violet-500/80 to-violet-500/30",
    cardActiveBg: "bg-violet-500/10",
    cardActiveBorder: "border-violet-500/60",
    cardHoverBorder: "hover:border-violet-500/45",
    iconBg: "bg-violet-500/20",
    iconText: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30",
  },
  emerald: {
    rail: "bg-gradient-to-b from-emerald-500/80 to-emerald-500/30",
    cardActiveBg: "bg-emerald-500/10",
    cardActiveBorder: "border-emerald-500/60",
    cardHoverBorder: "hover:border-emerald-500/45",
    iconBg: "bg-emerald-500/20",
    iconText: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
  },
  cyan: {
    rail: "bg-gradient-to-b from-cyan-500/80 to-cyan-500/30",
    cardActiveBg: "bg-cyan-500/10",
    cardActiveBorder: "border-cyan-500/60",
    cardHoverBorder: "hover:border-cyan-500/45",
    iconBg: "bg-cyan-500/20",
    iconText: "text-cyan-600 dark:text-cyan-300",
    ring: "ring-cyan-500/30",
  },
}

export function PreferencesAccordion({ sections }: { sections: PreferencesSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = sections.find((s) => s.id === activeId) ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sections.map((section) => {
          const styles = ACCENT_STYLES[section.accent]
          const isActive = section.id === activeId
          return (
            <button
              key={section.id}
              type="button"
              aria-expanded={isActive}
              aria-controls={`pref-panel-${section.id}`}
              onClick={() => setActiveId((prev) => (prev === section.id ? null : section.id))}
              className={cn(
                "group relative flex min-h-[150px] flex-col items-start gap-3 rounded-2xl border p-4 text-left shadow-sm shadow-black/5 transition-all",
                "hover:-translate-y-0.5 hover:shadow-md",
                isActive
                  ? cn(styles.cardActiveBg, styles.cardActiveBorder, "shadow-md")
                  : cn("border-border/70 bg-card/55", styles.cardHoverBorder)
              )}
            >
              <span
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-xl ring-1 transition-transform [&_svg]:size-6",
                  styles.iconBg,
                  styles.iconText,
                  styles.ring,
                  "group-hover:scale-105"
                )}
              >
                {section.icon}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-sm font-semibold leading-tight text-foreground">
                  {section.title}
                </h2>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {section.description}
                </p>
              </div>
              <ChevronDown
                aria-hidden
                className={cn(
                  "absolute right-3 top-3 size-4 text-muted-foreground/60 transition-transform",
                  isActive && "rotate-180 text-foreground/70"
                )}
              />
            </button>
          )
        })}
      </div>

      {active && (
        <section
          id={`pref-panel-${active.id}`}
          className="relative scroll-mt-4 overflow-hidden rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5 backdrop-blur"
        >
          <div
            aria-hidden
            className={cn("absolute inset-y-0 left-0 w-1", ACCENT_STYLES[active.accent].rail)}
          />
          <div className="space-y-4 px-4 py-4 pl-5 sm:px-5 sm:py-5 sm:pl-6">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-5",
                  ACCENT_STYLES[active.accent].iconBg,
                  ACCENT_STYLES[active.accent].iconText,
                  ACCENT_STYLES[active.accent].ring
                )}
              >
                {active.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold leading-tight text-foreground">
                  {active.title}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{active.description}</p>
              </div>
            </div>
            <div>{active.content}</div>
          </div>
        </section>
      )}
    </div>
  )
}
