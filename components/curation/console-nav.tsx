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
  Plus,
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
import { Button } from "@/components/ui/button"
import { decisionCountsByHref } from "@/lib/curation/decision-queues"
import type { SettingsAccent } from "@/lib/settings-accent"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { cn } from "@/lib/utils"

/** Um tópico de /curation/settings, já reduzido ao que atravessa a fronteira server→client. */
export interface ConsoleSettingsGroup {
  id: string
  label: string
  iconName: string
  accent: SettingsAccent
}

interface ConsoleNavProps {
  settingsGroups: ConsoleSettingsGroup[]
  /**
   * Tópico que /curation/settings abre sem `?g=`. Vem do servidor (`DEFAULT_GROUP_ID`) em vez
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
  /** Quando presente, o item vira ramo e os tópicos de /curation/settings entram embaixo. */
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
 * virou aba de `/my-ai-scores` e é de qualquer logado. `/ranking/desatualizados`
 * segue como redirect pra links antigos, só sem entrada de menu — um item de console
 * que joga o usuário PRA FORA da console é pior do que um item ausente.
 *
 * UMA sidebar, com dois níveis. Os quatro tópicos de Configurações eram uma segunda
 * sub-nav (`SettingsSubnav`), que empilhada nesta daria duas sidebars lado a lado.
 * O componente segue existindo — `/preferences` (que é do usuário, e por isso nunca
 * entrou na console) continua usando.
 */
const ENTRIES: ConsoleEntry[] = [
  {
    href: "/curation",
    label: "Visão geral",
    hint: "o que precisa de decisão",
    iconName: "LayoutDashboard",
    accent: "cyan",
  },
  {
    href: "/curation/works",
    label: "Curadoria da Obra",
    hint: "fila de atributos",
    iconName: "Wrench",
    accent: "violet",
  },
  {
    href: "/curation/requests",
    label: "Pedidos",
    hint: "o que o leitor pediu",
    iconName: "Inbox",
    accent: "amber",
  },
  {
    href: "/curation/settings",
    label: "Configurações",
    hint: "",
    iconName: "Settings",
    accent: "slate",
    branch: "settings",
  },
  {
    href: "/curation/ai-usage",
    label: "Uso da API IA",
    hint: "custo e chamadas",
    iconName: "Activity",
    accent: "emerald",
  },
  {
    href: "/curation/model-metrics",
    label: "Métricas do modelo",
    hint: "acurácia da Prevista",
    iconName: "ChartNoAxesCombined",
    accent: "indigo",
  },
]

/**
 * Rota ativa. `/curation` casa EXATO; o resto por prefixo (têm sub-rotas).
 *
 * 🔴 O ternário virou load-bearing em 2026-08-16, quando os quatro membros desceram
 * pra dentro de `/curation/*`. Antes a raiz tinha um filho só (`/curadoria/pedidos`) e
 * os outros eram rotas irmãs; hoje a raiz é prefixo de TODOS — trocar isto por um
 * `startsWith` uniforme deixa a "Visão geral" acesa nas cinco páginas da console, com
 * duas linhas marcadas `aria-current="page"` ao mesmo tempo. Não quebra nada: só passa
 * a mentir sobre onde você está.
 */
function isEntryActive(href: string, pathname: string): boolean {
  return href === "/curation" ? pathname === href : pathname.startsWith(href)
}

export function ConsoleNav({ settingsGroups, defaultSettingsGroup }: ConsoleNavProps) {
  const pathname = usePathname() ?? ""
  const { settings, settingsByGroup, curadoria, requests } = useChromeBadges()

  // As filas saem de `DECISION_QUEUES` — a mesma lista que o badge da barra soma e que a
  // Visão geral detalha. Redigitar os `href` aqui é como o badge da sidebar some sozinho:
  // chave que não casa vira `undefined`, o `?? 0` vira zero, e zero não desenha nada.
  // `/curation/settings` fica de fora da lista de propósito: é pendência de CONFIGURAÇÃO, tem badge
  // próprio e não é fila de decisão sobre obra.
  const counts: Record<string, number> = {
    ...decisionCountsByHref({ curadoria, requests }),
    "/curation/settings": settings,
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

        <NewWorkShortcut />
      </div>
    </aside>
  )
}

/**
 * O atalho de criar obra — no RODAPÉ, e fora da lista de propósito.
 *
 * A lista responde "onde eu trabalho"; criar obra é "o que eu faço", e é o único
 * caminho daqui que joga o curador **pra fora** da console (`/catalog/new`). Virar
 * o 7º item faria dele um destino da console — a mesma régua que já custou caro na
 * barra superior, onde destino e sinal foram misturados.
 *
 * `mt-auto` e não posição fixa: enquanto a lista cabe na tela (o caso de hoje, 6
 * itens), o botão encosta logo abaixo dela; quando não couber, o `<nav>` rola e o
 * botão fica visível no pé em vez de sumir junto com o resto.
 *
 * Sem gate próprio: quem renderiza esta sidebar já passou pelo `isCurrentUserAdmin()`
 * da `CurationConsole` — o mesmo papel que `/catalog/new` exige pra salvar.
 */
function NewWorkShortcut() {
  return (
    <div className="mt-auto border-t border-border/70 px-2.5 pb-3 pt-2.5">
      <Button asChild className="w-full">
        <Link href="/catalog/new">
          <Plus />
          Nova obra
        </Link>
      </Button>
    </div>
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
 * ⚠️ A LINHA INTEIRA É BOTÃO — não navega, só abre/fecha. Antes o rótulo era `<Link>`
 * pra `/curation/settings` e só a seta expandia, o que dava dois alvos de clique com destinos
 * diferentes a 20px um do outro: quem mirava o texto pra ver os tópicos ia parar numa
 * página. E o link não levava a lugar nenhum de próprio — `/curation/settings` sem `?g=` abre o
 * tópico default, ou seja, o MESMO destino do 1º filho. Quem navega são os tópicos.
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
  // ou SAIR de /curation/settings a escolha manual é descartada, senão um ramo fechado numa
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
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className={rowClass(entry.accent, active)}
      >
        <EntryRow
          entry={entry}
          active={active}
          count={count}
          subtitle={`${groups.length} tópicos`}
        />
        <ChevronDown
          aria-hidden
          className={cn(
            "-mr-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

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
 * Tópico de /curation/settings — 2º nível. Continua sendo `?g=` na MESMA rota (nenhum
 * deep-link mudou, inclusive o `/curation/settings?g=fontes` do alerta do Comix na barra).
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
  const active = pathname.startsWith("/curation/settings") && (sp.get("g") ?? defaultGroup) === group.id

  return (
    <Link
      href={`/curation/settings?g=${group.id}`}
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

  const value = pathname.startsWith("/curation/settings")
    ? `/curation/settings?g=${sp.get("g") ?? defaultSettingsGroup}`
    : (ENTRIES.find((e) => isEntryActive(e.href, pathname))?.href ?? "/curation")

  return (
    // O atalho fica AO LADO do seletor, nunca dentro dele: `<option>` navega, mas um
    // seletor que às vezes cria obra e às vezes muda de seção mente sobre o que é.
    <div className="mb-4 flex items-stretch gap-2 md:hidden">
      <label className="min-w-0 flex-1">
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
                  <option key={g.id} value={`/curation/settings?g=${g.id}`}>
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
      <Button asChild className="h-auto w-11 shrink-0 rounded-xl px-0">
        <Link href="/catalog/new" aria-label="Nova obra" title="Nova obra">
          <Plus />
        </Link>
      </Button>
    </div>
  )
}
