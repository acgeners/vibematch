import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import {
  ACCENT_STYLES,
  COST_TIER_STYLES,
} from "@/components/console/console-registry"
import { ItemHelpPopover } from "@/components/settings/item-help-popover"
import { CollapsibleCardInner } from "@/components/settings/collapsible-card"
import type { SettingsAccent } from "@/lib/settings-accent"
import type { SettingsChip, SettingsSection } from "@/app/settings/sections"
import { panelTitleOf } from "@/app/settings/sections"
import { cn } from "@/lib/utils"

/**
 * Card de um item na pilha do tópico. Cabeçalho (trilho de accent + ícone + título
 * + ⓘ + chips + descrição) e o corpo (`children`). Um accent por grupo — a cor é
 * hierarquia de grupo, não decoração por-item. `id` ancorável (`#card-<id>`).
 *
 * `collapsible` (tópicos com 2+ itens): o card ganha uma seta que expande/recolhe
 * o corpo, com estado lembrado por card. Item único de um tópico fica sempre
 * aberto, sem seta.
 */
export function SettingsCard({
  section,
  accent,
  collapsible = false,
  forceOpen = false,
  serverCollapse,
  storageKeyPrefix = "settings-card",
  pending = 0,
  readControl,
  children,
}: {
  section: SettingsSection
  accent: SettingsAccent
  collapsible?: boolean
  /** Deep-link `?open=` — mantém este card aberto mesmo se estava recolhido. */
  forceOpen?: boolean
  /**
   * Colapso pelo SERVIDOR (`?open=`) para ferramentas pesadas: a seta do header
   * vira um link que abre/recolhe e o corpo só é renderizado quando `open` — ou
   * seja, um único controle que também adia o carregamento (sem o botão "Abrir"
   * redundante). Tem precedência sobre `collapsible` (a setinha client).
   */
  serverCollapse?: { open: boolean; href: string }
  /** Prefixo da chave do localStorage — separa /settings de /preferencias. */
  storageKeyPrefix?: string
  /** Pendências deste item — mostra uma pílula no cabeçalho quando > 0. */
  pending?: number
  /** Controle de "lido" no cabeçalho (botão/selo), ao lado da pílula. */
  readControl?: ReactNode
  children: ReactNode
}) {
  const s = ACCENT_STYLES[accent]
  const Icon = section.icon
  const title = panelTitleOf(section)

  const headerInner = (
    <>
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
      {pending > 0 && (
        <span
          className={cn(
            "mt-0.5 inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs font-bold ring-1",
            s.cardBg,
            s.iconText,
            s.ring
          )}
          title={`${pending} ${pending === 1 ? "pendência" : "pendências"} neste item`}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {pending > 99 ? "99+" : pending}
          <span className="font-medium opacity-75">
            {pending === 1 ? "pendente" : "pendentes"}
          </span>
        </span>
      )}
      {readControl}
    </>
  )

  return (
    <section
      id={`card-${section.id}`}
      className="relative scroll-mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card/55 shadow-sm shadow-black/5"
    >
      <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", s.rail)} />
      {serverCollapse ? (
        <div className="px-5 py-5 pl-6">
          <div className="flex items-start gap-3.5">
            {headerInner}
            <Link
              href={serverCollapse.href}
              aria-expanded={serverCollapse.open}
              scroll={false}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-card/60 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ChevronDown
                className={cn("size-4 transition-transform", serverCollapse.open ? "" : "-rotate-90")}
              />
              <span className="sr-only">{serverCollapse.open ? "Recolher item" : "Expandir item"}</span>
            </Link>
          </div>
          {serverCollapse.open && <div className="mt-4 border-t border-border/60 pt-4">{children}</div>}
        </div>
      ) : collapsible ? (
        <div className="px-5 py-5 pl-6">
          <CollapsibleCardInner
            storageKey={`${storageKeyPrefix}:${section.id}`}
            forceOpen={forceOpen}
            headerInner={headerInner}
          >
            {children}
          </CollapsibleCardInner>
        </div>
      ) : (
        <div className="space-y-4 px-5 py-5 pl-6">
          <div className="flex items-start gap-3.5">{headerInner}</div>
          <div>{children}</div>
        </div>
      )}
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
