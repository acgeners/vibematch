"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  Gauge,
  Globe,
  Inbox,
  LayoutDashboard,
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
import { decisionCountsByHref } from "@/lib/curadoria/decision-queues"
import type { SettingsAccent } from "@/lib/settings-accent"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { cn } from "@/lib/utils"

/** Um tópico de /settings, já reduzido ao que atravessa a fronteira server→client. */
export interface ConsoleSettingsGroup {
  id: string
  label: string
  iconName: string
  accent: SettingsAccent
}

interface ConsoleNavProps {
  settingsGroups: ConsoleSettingsGroup[]
  /**
   * Tópico que /settings abre sem `?g=`. Vem do servidor (`DEFAULT_GROUP_ID`) em vez
   * de ser constante aqui: hardcodado, uma reordenação de `SETTINGS_GROUPS` faria a
   * sidebar marcar um tópico e a página renderizar outro — sem erro nenhum.
   */
  defaultSettingsGroup: string
}

// Mesmo registry por NOME do `settings-nav` — o ícone é escolhido no servidor
// (`SETTINGS_GROUPS`) e só a string cruza pro client.
const ICONS: Record<string, LucideIcon> = {
  Gauge,
  Sparkles,
  Globe,
  Wrench,
  Trophy,
  Scale,
  Palette,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  ChartNoAxesCombined,
  Activity,
  LayoutDashboard,
  Inbox,
}

interface ConsoleEntry {
  href: string
  label: string
  hint: string
  iconName: string
  accent: SettingsAccent
  /** Quando presente, o item vira ramo e os tópicos de /settings entram embaixo. */
  branch?: "settings"
}

/**
 * A console do catálogo — as ferramentas do Curador, num lugar só.
 *
 * A régua da navegação: **o topo é sobre obras, o avatar é sobre você, a console é
 * sobre o catálogo dos outros.** Foi ela que separou as 6 páginas do antigo bloco
 * "Gerenciar": Preferências/Importar/Painel são do usuário e foram pro menu do
 * avatar; o que ficou — avaliar atributos, configurar o pipeline, ver o custo da
 * IA e a acurácia do modelo — muta ou mede o catálogo COMPARTILHADO, e é isto.
 *
 * ⚠️ "Desatualizados" NÃO entra, apesar de constar no plano original: aquela fila
 * virou aba de `/fila-recomendacao` e é de qualquer logado. `/ranking/desatualizados`
 * segue como redirect pra links antigos, só sem entrada de menu — um item de console
 * que joga o usuário PRA FORA da console é pior do que um item ausente.
 *
 * UMA sidebar, com dois níveis. Os quatro tópicos de Configurações eram uma segunda
 * sub-nav (`SettingsSubnav`), que empilhada nesta daria duas sidebars lado a lado.
 * O componente segue existindo — `/preferencias` (que é do usuário, e por isso nunca
 * entrou na console) continua usando.
 */
const ENTRIES: ConsoleEntry[] = [
  {
    href: "/curadoria",
    label: "Visão geral",
    hint: "o que precisa de decisão",
    iconName: "LayoutDashboard",
    accent: "cyan",
  },
  {
    href: "/ai-evaluation",
    label: "Curadoria da Obra",
    hint: "fila de atributos",
    iconName: "Wrench",
    accent: "violet",
  },
  {
    href: "/curadoria/pedidos",
    label: "Pedidos",
    hint: "o que o leitor pediu",
    iconName: "Inbox",
    accent: "amber",
  },
  {
    href: "/settings",
    label: "Configurações",
    hint: "",
    iconName: "Settings",
    accent: "slate",
    branch: "settings",
  },
  {
    href: "/ai-usage",
    label: "Uso da API IA",
    hint: "custo e chamadas",
    iconName: "Activity",
    accent: "emerald",
  },
  {
    href: "/admin/model-metrics",
    label: "Métricas do modelo",
    hint: "acurácia da Prevista",
    iconName: "ChartNoAxesCombined",
    accent: "indigo",
  },
]

/** Rota ativa. `/curadoria` casa exato; o resto por prefixo (tem sub-rotas). */
function isEntryActive(href: string, pathname: string): boolean {
  return href === "/curadoria" ? pathname === href : pathname.startsWith(href)
}

export function ConsoleNav({ settingsGroups, defaultSettingsGroup }: ConsoleNavProps) {
  const pathname = usePathname() ?? ""
  const { settings, settingsByGroup, curadoria, requests } = useChromeBadges()

  // As filas saem de `DECISION_QUEUES` — a mesma lista que o badge da barra soma e que a
  // Visão geral detalha. Redigitar os `href` aqui é como o badge da sidebar some sozinho:
  // chave que não casa vira `undefined`, o `?? 0` vira zero, e zero não desenha nada.
  // `/settings` fica de fora da lista de propósito: é pendência de CONFIGURAÇÃO, tem badge
  // próprio e não é fila de decisão sobre obra.
  const counts: Record<string, number> = {
    ...decisionCountsByHref({ curadoria, requests }),
    "/settings": settings,
  }

  return (
    <aside
      className="hidden shrink-0 border-r border-border/70 bg-card/40 backdrop-blur md:flex md:w-[244px] md:flex-col"
      aria-label="Curadoria do catálogo — seções"
    >
      <div className="sticky top-0 flex max-h-dvh flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-border/70 bg-gradient-to-b from-card/70 to-card/25 px-4 shadow-sm shadow-black/5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-600 ring-1 ring-violet-500/25 dark:text-violet-300 [&_svg]:size-[18px]">
            <Wrench />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight text-foreground">Curadoria</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              do catálogo
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-2.5">
          <p className="px-2 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
            Console
          </p>
          <ul className="space-y-1">
            {ENTRIES.map((entry) => (
              <li key={entry.href}>
                {entry.branch === "settings" ? (
                  <SettingsBranch
                    entry={entry}
                    active={isEntryActive(entry.href, pathname)}
                    count={counts[entry.href] ?? 0}
                    groups={settingsGroups}
                    groupCounts={settingsByGroup}
                    defaultGroup={defaultSettingsGroup}
                  />
                ) : (
                  <Link
                    href={entry.href}
                    aria-current={isEntryActive(entry.href, pathname) ? "page" : undefined}
                    className={rowClass(entry.accent, isEntryActive(entry.href, pathname))}
                  >
                    <EntryRow
                      entry={entry}
                      active={isEntryActive(entry.href, pathname)}
                      count={counts[entry.href] ?? 0}
                    />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  )
}

function rowClass(accent: SettingsAccent, active: boolean): string {
  const s = ACCENT_STYLES[accent]
  return cn(
    "group relative flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors",
    active ? cn(s.cardBg, s.cardBorder) : cn("border-transparent hover:bg-card/70", s.cardHoverBorder),
  )
}

/** O miolo de um item de 1º nível — trilho, ícone, rótulo, dica e badge. */
function EntryRow({
  entry,
  active,
  count,
  subtitle,
}: {
  entry: ConsoleEntry
  active: boolean
  count: number
  subtitle?: string
}) {
  const s = ACCENT_STYLES[entry.accent]
  const Icon = ICONS[entry.iconName] ?? Settings
  return (
    <>
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
          s.ring,
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-semibold leading-tight",
            active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {entry.label}
        </span>
        <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
          {subtitle ?? entry.hint}
        </span>
      </span>
      {count > 0 && (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10.5px] font-bold leading-none tabular-nums text-primary-foreground ring-1 ring-white/15">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </>
  )
}

/**
 * "Configurações" + os seus quatro tópicos.
 *
 * O rótulo é LINK e a seta é BOTÃO, separados de propósito: um ramo que só expande
 * transforma o item mais visitado da console num item que não vai a lugar nenhum —
 * e HTML não permite `<button>` dentro de `<a>`, então não dá pra fundir os dois.
 */
function SettingsBranch({
  entry,
  active,
  count,
  groups,
  groupCounts,
  defaultGroup,
}: {
  entry: ConsoleEntry
  active: boolean
  count: number
  groups: ConsoleSettingsGroup[]
  groupCounts: Record<string, number>
  defaultGroup: string
}) {
  // `null` = "segue a rota"; um booleano = o usuário mandou abrir/fechar. Ao ENTRAR
  // ou SAIR de /settings a escolha manual é descartada, senão um ramo fechado numa
  // visita anterior esconderia o tópico ativo — a sidebar ficaria sem indicar onde
  // se está. Ajuste-durante-render semeado com o valor atual (não com `null`), pra
  // não disparar na renderização de hidratação.
  const [manual, setManual] = useState<boolean | null>(null)
  const [lastActive, setLastActive] = useState(active)
  if (lastActive !== active) {
    setLastActive(active)
    setManual(null)
  }
  const open = manual ?? active

  return (
    <>
      <div className={rowClass(entry.accent, active)}>
        <Link
          href={entry.href}
          aria-current={active ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <EntryRow
            entry={entry}
            active={active}
            count={count}
            subtitle={`${groups.length} tópicos`}
          />
        </Link>
        <button
          type="button"
          onClick={() => setManual(!open)}
          aria-expanded={open}
          aria-label={open ? "Recolher tópicos de Configurações" : "Expandir tópicos de Configurações"}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <ul className="ml-[19px] mt-1 space-y-0.5 border-l border-border pl-2.5">
          {groups.map((g) => (
            <li key={g.id}>
              <SettingsTopicLink
                group={g}
                count={groupCounts[g.id] ?? 0}
                defaultGroup={defaultGroup}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Tópico de /settings — 2º nível. Continua sendo `?g=` na MESMA rota (nenhum
 * deep-link mudou, inclusive o `/settings?g=fontes` do alerta do Comix na barra).
 * Sem tile de ícone de propósito: a hierarquia vem do recuo e do trilho, não de
 * repetir a anatomia do pai um nível abaixo.
 */
function SettingsTopicLink({
  group,
  count,
  defaultGroup,
}: {
  group: ConsoleSettingsGroup
  count: number
  defaultGroup: string
}) {
  const pathname = usePathname() ?? ""
  const sp = useSearchParams()
  const s = ACCENT_STYLES[group.accent]
  // Sem `?g=`, quem está ativo é o tópico default — é o que a página renderiza.
  const active = pathname.startsWith("/settings") && (sp.get("g") ?? defaultGroup) === group.id

  return (
    <Link
      href={`/settings?g=${group.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-2 transition-colors",
        active
          ? cn(s.cardBg, "font-semibold text-foreground")
          : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn("absolute -left-[11px] top-1.5 bottom-1.5 w-[2px] rounded-full", s.rail)}
        />
      )}
      <span
        aria-hidden
        className={cn("size-[7px] shrink-0 rounded-full bg-current ring-2", s.iconText, s.ring)}
      />
      <span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{group.label}</span>
      {count > 0 && (
        <span
          className={cn(
            "inline-flex min-w-4 shrink-0 items-center justify-center rounded-full px-1 py-0.5 text-[9.5px] font-bold leading-none tabular-nums ring-1",
            s.iconBg,
            s.iconText,
            s.ring,
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )
}

/** Seletor no mobile — a sidebar some abaixo de `md`. */
export function ConsoleMobileNav({ settingsGroups, defaultSettingsGroup }: ConsoleNavProps) {
  const pathname = usePathname() ?? ""
  const sp = useSearchParams()
  const router = useRouter()

  const value = pathname.startsWith("/settings")
    ? `/settings?g=${sp.get("g") ?? defaultSettingsGroup}`
    : (ENTRIES.find((e) => isEntryActive(e.href, pathname))?.href ?? "/curadoria")

  return (
    <label className="mb-4 block md:hidden">
      <span className="sr-only">Seção da curadoria</span>
      <select
        value={value}
        onChange={(e) => router.push(e.target.value)}
        className="w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-sm font-medium text-foreground outline-none"
      >
        {ENTRIES.map((e) =>
          e.branch === "settings" ? (
            <optgroup key={e.href} label={e.label}>
              {settingsGroups.map((g) => (
                <option key={g.id} value={`/settings?g=${g.id}`}>
                  {g.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={e.href} value={e.href}>
              {e.label}
            </option>
          ),
        )}
      </select>
    </label>
  )
}
