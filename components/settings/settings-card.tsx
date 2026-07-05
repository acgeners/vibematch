import type { ReactNode } from "react"
import {
  ACCENT_STYLES,
  COST_TIER_STYLES,
} from "@/components/console/console-registry"
import { ItemHelpPopover } from "@/components/settings/item-help-popover"
import type { SettingsAccent } from "@/lib/settings-accent"
import type { SettingsChip, SettingsSection } from "@/app/settings/sections"
import { panelTitleOf } from "@/app/settings/sections"
import { cn } from "@/lib/utils"

/**
 * Card de um item na pilha do tópico. Cabeçalho (trilho de accent + ícone + título
 * + ⓘ + chips + descrição) e o corpo (`children`). Um accent por grupo — a cor é
 * hierarquia de grupo, não decoração por-item. `id` ancorável (`#card-<id>`).
 */
export function SettingsCard({
  section,
  accent,
  children,
}: {
  section: SettingsSection
  accent: SettingsAccent
  children: ReactNode
}) {
  const s = ACCENT_STYLES[accent]
  const Icon = section.icon
  const title = panelTitleOf(section)
  return (
    <section
      id={`card-${section.id}`}
      className="relative scroll-mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card/55 shadow-sm shadow-black/5"
    >
      <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", s.rail)} />
      <div className="space-y-4 px-5 py-5 pl-6">
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl ring-1 [&_svg]:size-[22px]",
              s.iconBg,
              s.iconText,
              s.ring
            )}
          >
            <Icon />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
              <ItemHelpPopover title={title} help={section.help} accent={accent} />
            </div>
            {section.chips && section.chips.length > 0 && (
              <Chips chips={section.chips} accent={accent} />
            )}
            <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
          </div>
        </div>
        <div>{children}</div>
      </div>
    </section>
  )
}

function Chips({ chips, accent }: { chips: SettingsChip[]; accent: SettingsAccent }) {
  const s = ACCENT_STYLES[accent]
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
                s.iconBg,
                s.iconText,
                s.ring
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
