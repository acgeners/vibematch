"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  BookOpen,
  Gauge,
  Globe,
  Palette,
  Scale,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { SettingsAccent } from "@/lib/settings-accent"
import { cn } from "@/lib/utils"

export interface SubnavGroup {
  id: string
  label: string
  /** Nome do ícone (serializável — o registry de ícones vive aqui no client). */
  iconName: string
  accent: SettingsAccent
  itemCount: number
  pending: number
}

// Ícones por NOME. O registry das seções vive no servidor e não pode cruzar
// LucideIcon como prop pro client, então mapeamos por string aqui. Cobre os dois
// consoles que usam esta sub-nav (Configurações e Preferências).
const NAV_ICONS: Record<string, LucideIcon> = {
  Gauge,
  Sparkles,
  BookOpen,
  Globe,
  Wrench,
  Trophy,
  Scale,
  Palette,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
}

interface SubnavProps {
  groups: SubnavGroup[]
  defaultGroup: string
  /** Base da rota do console (ex.: "/settings", "/preferencias"). */
  basePath: string
  /** Cabeçalho da sub-camada. */
  title: string
  subtitle: string
  headerIconName: string
}

/**
 * Camada 2 — a sub-camada de um console. Colada na sidebar do site (o layout
 * quebra o padding do <main>), mesmo padrão visual. Lista os tópicos do console.
 * Compartilhada por /settings e /preferencias (parametrizada por `basePath`).
 */
export function SettingsSubnav({
  groups,
  defaultGroup,
  basePath,
  title,
  subtitle,
  headerIconName,
}: SubnavProps) {
  const sp = useSearchParams()
  const active = sp.get("g") ?? defaultGroup
  const HeaderIcon = NAV_ICONS[headerIconName] ?? Settings

  return (
    <aside
      className="hidden shrink-0 border-r border-border/70 bg-card/40 backdrop-blur md:flex md:w-[244px] md:flex-col"
      aria-label={`${title} — tópicos`}
    >
      <div className="sticky top-0 flex max-h-dvh flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-border/70 bg-gradient-to-b from-card/70 to-card/25 px-4 shadow-sm shadow-black/5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/25 [&_svg]:size-[18px]">
            <HeaderIcon />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight text-foreground">{title}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-2.5">
          <p className="px-2 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
            Tópicos
          </p>
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.id}>
                <TopicLink group={g} basePath={basePath} active={g.id === active} />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  )
}

function TopicLink({
  group,
  basePath,
  active,
}: {
  group: SubnavGroup
  basePath: string
  active: boolean
}) {
  const s = ACCENT_STYLES[group.accent]
  const Icon = NAV_ICONS[group.iconName] ?? Settings
  return (
    <Link
      href={`${basePath}?g=${group.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 transition-colors",
        active
          ? cn(s.cardBg, s.cardBorder)
          : cn("border-transparent hover:bg-card/70", s.cardHoverBorder)
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn("absolute -left-px top-2 bottom-2 w-[3px] rounded-r-full", s.rail)}
        />
      )}
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg ring-1 [&_svg]:size-[18px]",
          s.iconBg,
          s.iconText,
          s.ring
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-semibold leading-tight",
            active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
          )}
        >
          {group.label}
        </span>
        <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
          {group.itemCount} {group.itemCount === 1 ? "item" : "itens"}
        </span>
      </span>
      {group.pending > 0 && (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-primary-foreground ring-1 ring-white/15">
          {group.pending > 99 ? "99+" : group.pending}
        </span>
      )}
    </Link>
  )
}

/** Seletor de tópico no mobile (a sub-nav some abaixo de md). */
export function SettingsMobileNav({
  groups,
  defaultGroup,
  basePath,
}: {
  groups: SubnavGroup[]
  defaultGroup: string
  basePath: string
}) {
  const sp = useSearchParams()
  const router = useRouter()
  const active = sp.get("g") ?? defaultGroup
  return (
    <label className="mb-4 block md:hidden">
      <span className="sr-only">Tópico</span>
      <select
        value={active}
        onChange={(e) => router.push(`${basePath}?g=${e.target.value}`)}
        className="w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-sm font-medium text-foreground outline-none"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
            {g.pending > 0 ? ` (${g.pending})` : ""}
          </option>
        ))}
      </select>
    </label>
  )
}
