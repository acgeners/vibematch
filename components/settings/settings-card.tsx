import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronDown, Coins, Repeat, Shapes, Zap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  ACCENT_STYLES,
  CHIP_KIND_STYLES,
  COST_TIER_STYLES,
} from "@/components/console/console-registry"
import { ItemHelpPopover } from "@/components/settings/item-help-popover"
import { CollapsibleCardInner } from "@/components/settings/collapsible-card"
import type { SettingsAccent } from "@/lib/settings-accent"
import type { SettingsChip, SettingsSection } from "@/app/curation/settings/sections"
import { panelTitleOf } from "@/app/curation/settings/sections"
import { cn } from "@/lib/utils"

// Ring de accent quando o card está EXPANDIDO (#4). Aplicado via `:has()` no
// <section> porque o estado "aberto" dos cards colapsáveis é client-side
// (localStorage) e não chega ao servidor — o CollapsibleCardInner / serverCollapse
// marcam `data-card-open="true"` no header e o <section> reage. Literais completos
// (o JIT do Tailwind não vê classe interpolada).
const OPEN_RING: Record<SettingsAccent, string> = {
  cyan: "has-[[data-card-open=true]]:ring-cyan-500/40",
  violet: "has-[[data-card-open=true]]:ring-violet-500/40",
  emerald: "has-[[data-card-open=true]]:ring-emerald-500/40",
  slate: "has-[[data-card-open=true]]:ring-slate-500/40",
  amber: "has-[[data-card-open=true]]:ring-amber-500/40",
  indigo: "has-[[data-card-open=true]]:ring-indigo-500/40",
  rose: "has-[[data-card-open=true]]:ring-rose-500/40",
  fuchsia: "has-[[data-card-open=true]]:ring-fuchsia-500/40",
}

// Header colado no topo enquanto o corpo do card está na viewport (#8). Barra com
// padding PRÓPRIO (não fica espremida ao grudar), bg OPACO (o conteúdo que rola por
// baixo não vaza) e cantos superiores arredondados (casa com o card). Exige o
// <section> sem overflow-hidden. O trilho fica em z-30 (por cima) pra não sumir.
// `top` negativo = o `<main>` (scroll container) tem padding-top (py-5 / md:py-7)
// e o sticky respeita esse padding, grudando abaixo dele; como o layout puxa o
// conteúdo por cima do padding (`-my-7`), compensamos aqui pra o header grudar
// RENTE ao topo da viewport.
const CARD_HEADER =
  "sticky -top-5 md:-top-7 z-10 flex items-start gap-3.5 rounded-t-2xl bg-card px-5 py-4 pl-6"
// Corpo com padding próprio + divisória sob o header (#4).
const CARD_BODY = "border-t border-border/60 px-5 pb-5 pl-6 pt-4"

/**
 * Card de um item na pilha do tópico. Cabeçalho (trilho de accent + ícone + título
 * + ⓘ + chips + descrição) e o corpo (`children`). Um accent por grupo — a cor é
 * hierarquia de grupo, não decoração por-item. `id` ancorável (`#card-<id>`).
 *
 * `collapsible` (tópicos com 2+ itens): o card ganha uma seta que expande/recolhe
 * o corpo, com estado lembrado por card. Item único de um tópico fica sempre
 * aberto, sem seta. Expandido: ring de accent + divisória sob o header + chevron
 * tingido; o header fica sticky enquanto o corpo está na viewport.
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
  /** Prefixo da chave do localStorage — separa /curation/settings de /preferences. */
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
        {/* #2: título + ⓘ + chips na MESMA linha (flex-wrap). Os chips ficam junto
            do título (metadados), nunca entre título e descrição. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
          {/* `data-no-toggle` + z-10: o ⓘ é interativo — clicar nele não pode
              expandir o card (nem no overlay clicável nem no header-botão). */}
          <span data-no-toggle className="relative z-10 inline-flex">
            <ItemHelpPopover title={title} help={section.help} accent={accent} />
          </span>
          {section.chips && section.chips.length > 0 && <Chips chips={section.chips} />}
        </div>
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
      {readControl && (
        // `contents`: não altera o layout do controle; só marca a subárvore como
        // interativa pra o clique (Desfazer/Lida) não expandir/recolher o card.
        <span data-no-toggle className="contents">
          {readControl}
        </span>
      )}
    </>
  )

  // Chevron do header: tingido no accent quando aberto, neutro quando fechado (#4).
  const chevron = (open: boolean) => (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 self-start place-items-center rounded-lg transition-colors",
        open
          ? cn(s.iconBg, s.iconText, "ring-1 ring-inset", s.ring)
          : "border border-border/60 bg-card/60 text-muted-foreground group-hover/hd:bg-muted/60 group-hover/hd:text-foreground"
      )}
    >
      <ChevronDown className={cn("size-4 transition-transform", open ? "" : "-rotate-90")} />
    </span>
  )

  return (
    <section
      id={`card-${section.id}`}
      className={cn(
        "relative scroll-mt-6 rounded-2xl border border-border/70 bg-card/55 shadow-sm shadow-black/5",
        "has-[[data-card-open=true]]:ring-1 has-[[data-card-open=true]]:ring-inset",
        OPEN_RING[accent]
      )}
    >
      <div aria-hidden className={cn("absolute inset-y-0 left-0 z-30 w-1 rounded-l-2xl", s.rail)} />
      {serverCollapse ? (
        <>
          {/* Cabeçalho inteiro clicável: um <Link> em overlay cobre o header. */}
          <div
            data-card-open={serverCollapse.open ? "true" : undefined}
            className={cn("group/hd relative transition-colors hover:bg-muted/25", CARD_HEADER)}
          >
            {headerInner}
            {chevron(serverCollapse.open)}
            <Link
              href={serverCollapse.href}
              aria-expanded={serverCollapse.open}
              scroll={false}
              className="absolute inset-0 rounded-t-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              <span className="sr-only">{serverCollapse.open ? "Recolher item" : "Expandir item"}</span>
            </Link>
          </div>
          {serverCollapse.open && <div className={CARD_BODY}>{children}</div>}
        </>
      ) : collapsible ? (
        <CollapsibleCardInner
          storageKey={`${storageKeyPrefix}:${section.id}`}
          forceOpen={forceOpen}
          accent={accent}
          headerInner={headerInner}
        >
          {children}
        </CollapsibleCardInner>
      ) : (
        <>
          {/* Item único de um tópico: sempre aberto (sem seta), mesmo header + corpo. */}
          <div data-card-open="true" className={CARD_HEADER}>
            {headerInner}
          </div>
          <div className={CARD_BODY}>{children}</div>
        </>
      )}
    </section>
  )
}

// Ícone por TIPO de chip — reforça a cor (custo/frequência/gatilho/natureza), pra
// dar pra bater o olho e saber que categoria de metadado o chip carrega.
const CHIP_ICON: Record<SettingsChip["kind"], LucideIcon> = {
  cost: Coins,
  cadence: Repeat,
  trigger: Zap,
  nature: Shapes,
}

function Chips({ chips }: { chips: SettingsChip[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip, i) => {
        const style = chip.kind === "cost" ? COST_TIER_STYLES[chip.tier] : CHIP_KIND_STYLES[chip.kind]
        const Icon = CHIP_ICON[chip.kind]
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
              style
            )}
          >
            <Icon className="size-3" aria-hidden />
            {chip.label}
          </span>
        )
      })}
    </div>
  )
}
