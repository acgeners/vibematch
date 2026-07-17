import type { LucideIcon } from "lucide-react"
import type { SettingsAccent } from "@/lib/settings-accent"

// Tipos + estilos + helpers GENÉRICOS do padrão "console" (drill-in card-grid).
// Compartilhados entre /settings e /preferencias — cada página fornece só o seu
// registry (`ConsoleGroup[]`) e o switch de painéis; a navegação (overview de
// cards + seletor rápido) e o visual saem daqui.

export type ConsoleAccent = SettingsAccent

export type ConsoleChip =
  | { kind: "step"; label: string }
  | { kind: "cadence"; label: string }
  | { kind: "cost"; tier: "free" | "low" | "high"; label: string }

export interface ConsoleSection {
  id: string
  /** Título curto (card do overview + seletor). */
  title: string
  /** Título (mais descritivo) do cabeçalho do painel. Cai pro `title` se ausente. */
  panelTitle?: string
  description: string
  icon: LucideIcon
  accent: ConsoleAccent
  chips?: ConsoleChip[]
  /** Itens que só apontam pra uma sub-rota (o painel é apenas um link). */
  nav?: { href: string; label: string }
}

export interface ConsoleGroup {
  label: string
  /** Frase curta ao lado do rótulo do grupo. */
  hint?: string
  /** Texto do tooltip (ⓘ) do grupo. */
  info?: string
  /** Grupo raro — renderizado recolhido (`<details>`) no overview. */
  advanced?: boolean
  /** Linha da tab-strip (padrão 1). Permite distribuir os chips em 2 linhas
   *  independentemente da ordem/agrupamento do overview. */
  stripRow?: number
  sections: ConsoleSection[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function allSections(groups: ConsoleGroup[]): ConsoleSection[] {
  return groups.flatMap((g) => g.sections)
}

export function findSection(groups: ConsoleGroup[], id: string): ConsoleSection | null {
  return allSections(groups).find((s) => s.id === id) ?? null
}

export function findGroupOf(groups: ConsoleGroup[], id: string): ConsoleGroup | null {
  return groups.find((g) => g.sections.some((s) => s.id === id)) ?? null
}

/** Primeira seção do primeiro grupo. */
export function firstSectionId(groups: ConsoleGroup[]): string {
  return groups[0]?.sections[0]?.id ?? ""
}

/** Valida o `?s` contra os ids conhecidos (rejeita deep-links quebrados). */
export function normalizeSectionId(
  groups: ConsoleGroup[],
  raw: string | string[] | undefined,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && allSections(groups).some((s) => s.id === value) ? value : null
}

export function panelTitleOf(section: ConsoleSection): string {
  return section.panelTitle ?? section.title
}

// ── Estilos por accent (cards do overview + cabeçalho do painel) ─────────────
// Uma cor = hierarquia de grupo, não decoração por-item.

type AccentStyle = {
  rail: string
  iconBg: string
  iconText: string
  ring: string
  cardBg: string
  cardBorder: string
  cardHoverBorder: string
  cardHoverShadow: string
}

export const ACCENT_STYLES: Record<ConsoleAccent, AccentStyle> = {
  cyan: {
    rail: "bg-gradient-to-b from-cyan-500/80 to-cyan-500/30",
    iconBg: "bg-cyan-500/20",
    iconText: "text-cyan-600 dark:text-cyan-300",
    ring: "ring-cyan-500/30",
    cardBg: "bg-cyan-500/15",
    cardBorder: "border-cyan-500/40",
    cardHoverBorder: "hover:border-cyan-500/70",
    cardHoverShadow: "hover:shadow-cyan-500/25",
  },
  violet: {
    rail: "bg-gradient-to-b from-violet-500/80 to-violet-500/30",
    iconBg: "bg-violet-500/20",
    iconText: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30",
    cardBg: "bg-violet-500/15",
    cardBorder: "border-violet-500/40",
    cardHoverBorder: "hover:border-violet-500/70",
    cardHoverShadow: "hover:shadow-violet-500/25",
  },
  emerald: {
    rail: "bg-gradient-to-b from-emerald-500/80 to-emerald-500/30",
    iconBg: "bg-emerald-500/20",
    iconText: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
    cardBg: "bg-emerald-500/15",
    cardBorder: "border-emerald-500/40",
    cardHoverBorder: "hover:border-emerald-500/70",
    cardHoverShadow: "hover:shadow-emerald-500/25",
  },
  slate: {
    rail: "bg-gradient-to-b from-slate-500/70 to-slate-500/20",
    iconBg: "bg-slate-500/20",
    iconText: "text-slate-500 dark:text-slate-300",
    ring: "ring-slate-500/30",
    cardBg: "bg-slate-500/15",
    cardBorder: "border-slate-500/40",
    cardHoverBorder: "hover:border-slate-500/70",
    cardHoverShadow: "hover:shadow-slate-500/20",
  },
  amber: {
    rail: "bg-gradient-to-b from-amber-500/80 to-amber-500/30",
    iconBg: "bg-amber-500/20",
    iconText: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/30",
    cardBg: "bg-amber-500/15",
    cardBorder: "border-amber-500/40",
    cardHoverBorder: "hover:border-amber-500/70",
    cardHoverShadow: "hover:shadow-amber-500/25",
  },
  indigo: {
    rail: "bg-gradient-to-b from-indigo-500/80 to-indigo-500/30",
    iconBg: "bg-indigo-500/20",
    iconText: "text-indigo-600 dark:text-indigo-300",
    ring: "ring-indigo-500/30",
    cardBg: "bg-indigo-500/15",
    cardBorder: "border-indigo-500/40",
    cardHoverBorder: "hover:border-indigo-500/70",
    cardHoverShadow: "hover:shadow-indigo-500/25",
  },
  rose: {
    rail: "bg-gradient-to-b from-rose-500/80 to-rose-500/30",
    iconBg: "bg-rose-500/20",
    iconText: "text-rose-600 dark:text-rose-300",
    ring: "ring-rose-500/30",
    cardBg: "bg-rose-500/15",
    cardBorder: "border-rose-500/40",
    cardHoverBorder: "hover:border-rose-500/70",
    cardHoverShadow: "hover:shadow-rose-500/25",
  },
  fuchsia: {
    rail: "bg-gradient-to-b from-fuchsia-500/80 to-fuchsia-500/30",
    iconBg: "bg-fuchsia-500/20",
    iconText: "text-fuchsia-600 dark:text-fuchsia-300",
    ring: "ring-fuchsia-500/30",
    cardBg: "bg-fuchsia-500/15",
    cardBorder: "border-fuchsia-500/40",
    cardHoverBorder: "hover:border-fuchsia-500/70",
    cardHoverShadow: "hover:shadow-fuchsia-500/25",
  },
}

// Custo usa cor semântica (verde→grátis, âmbar→barato, rosa→caro), independente
// do accent do grupo — vira um "semáforo" de custo legível de cara.
export const COST_TIER_STYLES: Record<"free" | "low" | "high", string> = {
  free: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  low: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  high: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
}

// Chips não-custo codificam o TIPO da informação por cor+ícone (não o accent do
// grupo): frequência (com que frequência rodar), gatilho (o que dispara o uso) e
// natureza (o que a etapa é/como age). Cada tipo = uma cor estável no app inteiro,
// pra bater o olho e saber que categoria de metadado o chip carrega. `ring` (não
// `border`): a utility de border-color está morta no projeto (globals.css).
export const CHIP_KIND_STYLES: Record<"cadence" | "trigger" | "nature", string> = {
  cadence: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  trigger: "bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300",
  nature: "bg-slate-500/15 text-slate-700 ring-slate-500/30 dark:text-slate-300",
}

export const NOTE_ACCENT: Record<ConsoleAccent, string> = {
  cyan: "border-cyan-500/30 bg-cyan-500/5",
  violet: "border-violet-500/30 bg-violet-500/5",
  emerald: "border-emerald-500/30 bg-emerald-500/5",
  slate: "border-slate-500/30 bg-slate-500/5",
  amber: "border-amber-500/30 bg-amber-500/5",
  indigo: "border-indigo-500/30 bg-indigo-500/5",
  rose: "border-rose-500/30 bg-rose-500/5",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/5",
}
