"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  BookMarked,
  Heart,
  Upload,
  Trophy,
  Sparkles,
  Settings,
  SlidersHorizontal,
  Wand2,
  Activity,
  AlertTriangle,
  ChevronLeft,
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSidebarBadgeCounts } from "@/server/actions/badges"
import { useChromeData } from "@/lib/use-refresh"
import { AccountChip } from "@/components/layout/account-chip"
import { BalanceChip } from "@/components/layout/balance-chip"
import { useIsAdmin } from "@/components/layout/admin-context"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { SidebarTasks } from "@/components/tasks/sidebar-tasks"

type BadgeKey = "ai-eval" | "settings"
// Derivado do retorno da action (evita importar o módulo server-only comix-gate no client).
type ComixHealth = Awaited<ReturnType<typeof getSidebarBadgeCounts>>["comixHealth"]

// Janela mínima entre re-fetches dos badges disparados por navegação. Mutações
// que esvaziam filas forçam o re-fetch na hora (evento global), então a navegação
// não precisa recontar a cada troca de rota (cada chamada ~450ms no DB remoto).
const BADGES_TTL_MS = 30_000

// Colapso do menu do site. As consoles de duas camadas (/settings, /preferencias)
// já têm a própria sub-nav, então o menu recolhe pra trilho ao entrar nelas
// (evita "duas barras"). Fora delas, a escolha manual persiste no navegador.
const SIDEBAR_COLLAPSED_KEY = "sidebar:collapsed"
const CONSOLE_ROUTE_PREFIXES = ["/settings", "/preferencias"]
function isConsoleRoute(pathname: string): boolean {
  return CONSOLE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

interface NavItem {
  href: string
  icon: typeof LayoutDashboard
  label: string
  // Marca o item como ativo apenas quando um query param específico está setado.
  // Quando ausente, o item-base do mesmo path fica inativo (evita dupla seleção).
  query?: { key: string; value: string }
  // Exibe um badge de pendências (contagem buscada no client por chave).
  badgeKey?: BadgeKey
}

// Accent por seção — mesmo vocabulário visual da sub-nav de /settings e
// /preferencias (cartão + chip com anel + trilho), restrito aqui a dois accents:
// Principal na cor da marca (primary) e Gerenciar em violet. Strings de classe
// completas (sem interpolação) para o Tailwind capturá-las.
type SidebarAccent = "primary" | "violet"

interface SidebarAccentClasses {
  /** Chip do ícone quando o item está inativo. */
  chipIdle: string
  /** Chip do ícone no item ativo. */
  chipActive: string
  /**
   * Fundo + borda do cartão do item ativo. A borda leva `!` (important) porque o
   * `* { border-color }` global (globals.css, sem layer) vence utilities normais
   * do Tailwind v4 — só borda quando selecionado.
   */
  itemActive: string
  /** Cor sólida do accent (trilho + pontinho de badge no modo trilho). */
  solid: string
  /** Fundo + texto do badge de pendências. */
  badge: string
}

const SIDEBAR_ACCENTS: Record<SidebarAccent, SidebarAccentClasses> = {
  primary: {
    chipIdle: "bg-primary/15 text-primary ring-primary/25 group-hover:bg-primary/25",
    chipActive: "bg-primary/25 text-primary ring-primary/45",
    itemActive: "border-primary/45! bg-primary/15",
    solid: "bg-primary",
    badge: "bg-primary text-primary-foreground",
  },
  violet: {
    chipIdle:
      "bg-violet-500/15 text-violet-600 ring-violet-500/25 group-hover:bg-violet-500/25 dark:text-violet-300",
    chipActive: "bg-violet-500/25 text-violet-600 ring-violet-500/45 dark:text-violet-300",
    itemActive: "border-violet-500/50! bg-violet-500/15",
    solid: "bg-violet-500",
    badge: "bg-violet-500 text-white",
  },
}

interface NavSection {
  title: string
  accent: SidebarAccent
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Principal",
    accent: "primary",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/titles", icon: BookOpen, label: "Títulos" },
      { href: "/leitura", icon: BookMarked, label: "Acompanhamento" },
      { href: "/ranking", icon: Trophy, label: "Ranking" },
      { href: "/favorites", icon: Heart, label: "Favoritos" },
      { href: "/recommendations", icon: Wand2, label: "Recomendações" },
    ],
  },
  {
    title: "Gerenciar",
    accent: "violet",
    items: [
      { href: "/preferencias", icon: SlidersHorizontal, label: "Preferências" },
      { href: "/settings", icon: Settings, label: "Configurações", badgeKey: "settings" },
      { href: "/ai-evaluation", icon: Sparkles, label: "Avaliação IA", badgeKey: "ai-eval" },
      { href: "/ai-usage", icon: Activity, label: "Uso da API IA" },
      { href: "/import", icon: Upload, label: "Importar" },
    ],
  },
]

// Lê window.location.search no client para refinar o estado ativo (item-com-query
// vs item-base no mesmo path). useSearchParams() falha o prerender estático de
// /_not-found mesmo sob Suspense, então sincronizamos durante render com base
// no pathname (padrão "adjust-during-render" — evita cascading renders do useEffect).
function useClientSearchParams(): URLSearchParams {
  const pathname = usePathname()
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams())
  const [lastPathname, setLastPathname] = useState<string | null>(null)

  if (typeof window !== "undefined" && pathname !== lastPathname) {
    setLastPathname(pathname)
    setParams(new URLSearchParams(window.location.search))
  }

  return params
}

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useClientSearchParams()
  // Stopgap multi-user: usuário logado (não-dono) é read-only. Esconde a seção
  // GERENCIAR (curadoria/config/import), o saldo Anthropic e o recalc — controles
  // do dono do catálogo. Vê só a navegação de leitura (Principal).
  const isAdmin = useIsAdmin()
  const sections = isAdmin
    ? NAV_SECTIONS
    : NAV_SECTIONS.filter((s) => s.title !== "Gerenciar")

  // Trilho ↔ expandido. Inicial = derivado da rota (determinístico p/ SSR, sem
  // localStorage). Sincroniza durante o render a cada troca de rota (padrão
  // "adjust-during-render", igual ao useClientSearchParams acima — evita o
  // cascading render do useEffect): nas consoles recolhe; fora delas aplica a
  // preferência salva no navegador.
  const [collapsed, setCollapsed] = useState<boolean>(() => isConsoleRoute(pathname))
  const [collapseSyncedPath, setCollapseSyncedPath] = useState<string | null>(null)
  if (typeof window !== "undefined" && pathname !== collapseSyncedPath) {
    setCollapseSyncedPath(pathname)
    setCollapsed(
      isConsoleRoute(pathname)
        ? true
        : window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
    )
  }
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev
      // Só persiste fora das consoles — nelas o padrão é recolher ao entrar.
      if (!isConsoleRoute(pathname)) {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
      }
      return next
    })

  // Badges de pendências (contagens):
  //   - "ai-eval":  obras NÃO-LIDAS nas 3 primeiras abas de /ai-evaluation
  //                 (atributos + Veredito IA + Interesse), união distinta.
  //                 "Marcar como lido" na página silencia sem resolver → o badge
  //                 some (só é renderizado quando > 0).
  //   - "settings": pendências do Pipeline de dados de /settings
  // Falha silenciosa em 0.
  const [badgeCounts, setBadgeCounts] = useState<Record<BadgeKey, number>>({
    "ai-eval": 0,
    settings: 0,
  })
  // Há edições de nota aguardando recálculo (fila de recálculo). Vem do mesmo
  // fetch dos badges; mostra o botão "Recalcular notas" no rodapé da sidebar.
  const [recalcPending, setRecalcPending] = useState(false)
  // Saúde do Comix (ComixGate): alerta discreto no rodapé quando degradado/fora.
  const [comixHealth, setComixHealth] = useState<ComixHealth>("unknown")

  // Re-busca os contadores a cada navegação (no máx. 1×/BADGES_TTL_MS — cada RPC
  // ~450ms no DB remoto) e, FORÇADO, quando uma mutação dispara o refresh do
  // chrome (ex.: zerar a fila de /ai-evaluation sem navegar). O coalescing e o
  // re-run pós-mutação vivem em useChromeData.
  useChromeData(
    getSidebarBadgeCounts,
    ({ aiEval, settings, recalcPending, comixHealth }) => {
      setBadgeCounts({ "ai-eval": aiEval, settings })
      setRecalcPending(recalcPending)
      setComixHealth(comixHealth)
    },
    BADGES_TTL_MS,
    (patch) => {
      // Delta otimista: ex.: avaliar uma obra tira 1 da fila de /ai-evaluation
      // sem re-contar no DB. Clampa em 0 (a navegação reconcilia o exato).
      if (patch.badgeDelta) {
        const { aiEval = 0, settings = 0 } = patch.badgeDelta
        setBadgeCounts((prev) => ({
          "ai-eval": Math.max(0, prev["ai-eval"] + aiEval),
          settings: Math.max(0, prev.settings + settings),
        }))
      }
      if (patch.recalcPending != null) setRecalcPending(patch.recalcPending)
    },
  )

  const isItemActive = (item: NavItem, siblings: NavItem[]): boolean => {
    const basePath = item.href.split("?")[0]
    const pathMatches = basePath === "/" ? pathname === "/" : pathname.startsWith(basePath)
    if (!pathMatches) return false
    if (item.query) {
      return searchParams.get(item.query.key) === item.query.value
    }
    return !siblings.some(
      (other) =>
        other !== item &&
        other.query &&
        other.href.split("?")[0] === basePath &&
        searchParams.get(other.query.key) === other.query.value
    )
  }

  return (
    <aside
      className={cn(
        "relative z-20 hidden min-h-screen shrink-0 flex-col border-r border-sidebar-border/80 bg-sidebar/95 shadow-[10px_0_30px_hsl(220_30%_5%/0.14)] backdrop-blur transition-[width] duration-200 md:flex",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-[4.3rem] z-30 hidden size-6 items-center justify-center rounded-full border border-sidebar-border/80 bg-sidebar text-muted-foreground shadow-md transition-colors hover:text-sidebar-foreground md:flex"
      >
        <ChevronLeft className={cn("size-3.5 transition-transform", collapsed && "rotate-180")} />
      </button>
      <div
        className={cn(
          "flex h-16 items-center gap-3 border-b border-sidebar-border/70 px-4",
          collapsed && "justify-center px-2"
        )}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-[hsl(200_98%_50%)] text-white shadow-md shadow-primary/30 ring-1 ring-white/15">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-9"
            aria-hidden="true"
          >
            {/* pétalas do lótus */}
            <path d="M12 17 Q8.5 11 12 5 Q15.5 11 12 17 Z" />
            <path d="M12 17 Q6.5 13.5 6 7 Q10.5 10.5 12 17 Z" />
            <path d="M12 17 Q17.5 13.5 18 7 Q13.5 10.5 12 17 Z" />
            <path d="M12 17 Q6 16 4 11 Q9 13 12 17 Z" />
            <path d="M12 17 Q18 16 20 11 Q15 13 12 17 Z" />
            {/* faísca de insight (IA) */}
            <path
              d="M12 1 C12.2 2.3 12.6 2.7 13.9 2.9 C12.6 3.1 12.2 3.5 12 4.8 C11.8 3.5 11.4 3.1 10.1 2.9 C11.4 2.7 11.8 2.3 12 1 Z"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="block text-base font-bold tracking-tight text-sidebar-foreground">
              Sator<span className="text-primary">IA</span>
            </span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-muted-foreground">
              Recomendações
              <br />
              que te entendem
            </span>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
        {sections.map((section) => {
          const accent = SIDEBAR_ACCENTS[section.accent]
          return (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => {
                const { href, icon: Icon, label } = item
                const active = isItemActive(item, section.items)
                const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-sm font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? cn("text-sidebar-foreground", accent.itemActive)
                        : // `border-transparent!` vence o `* { border-color }` global
                          // (sem layer) → item inativo fica SEM borda; só o selecionado tem.
                          "border-transparent! text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -left-px top-2 bottom-2 w-[3px] rounded-r-full transition-opacity",
                        accent.solid,
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span
                      className={cn(
                        "relative grid size-8 shrink-0 place-items-center rounded-lg ring-1 transition-colors",
                        active ? accent.chipActive : accent.chipIdle
                      )}
                    >
                      <Icon className="size-[18px]" />
                      {collapsed && badgeCount > 0 && (
                        <span
                          aria-label={`${badgeCount} na fila`}
                          className={cn(
                            "absolute -right-1 -top-1 size-2.5 rounded-full ring-2 ring-sidebar",
                            accent.solid
                          )}
                        />
                      )}
                    </span>
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && badgeCount > 0 && (
                      <span
                        aria-label={`${badgeCount} ${badgeCount === 1 ? "item" : "itens"} na fila`}
                        className={cn(
                          "ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none shadow-sm ring-1 ring-white/15",
                          accent.badge
                        )}
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {!collapsed && <SidebarTasks />}

      {(comixHealth === "down" || comixHealth === "degraded") && (
        <Link
          href="/settings"
          title={
            comixHealth === "down"
              ? "Comix indisponível (API exigindo token) — avaliações podem rodar sem reviews da Comix."
              : "Comix instável (FlareSolverr/Cloudflare) — algumas reviews da Comix podem faltar."
          }
          className={cn(
            "flex items-center gap-2 border-t border-sidebar-border/60 px-3 py-2 text-xs font-medium transition-colors",
            collapsed && "justify-center px-0",
            comixHealth === "down"
              ? "text-rose-500 hover:bg-rose-500/10"
              : "text-amber-500 hover:bg-amber-500/10",
          )}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {!collapsed && (
            <span className="truncate">
              Comix {comixHealth === "down" ? "fora" : "instável"}
            </span>
          )}
        </Link>
      )}

      {recalcPending && isAdmin &&
        (collapsed ? (
          // No trilho: indicador abreviado (ícone + ponto). Clicar expande pra
          // revelar o controle completo de recálculo.
          <div className="flex justify-center border-t border-sidebar-border/60 py-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title="Há notas aguardando recálculo — clique pra abrir"
              aria-label="Notas aguardando recálculo"
              className="relative grid size-9 place-items-center rounded-lg text-amber-500 transition-colors hover:bg-amber-500/10"
            >
              <Calculator className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-sidebar" />
            </button>
          </div>
        ) : (
          <div className="border-t border-sidebar-border/60 px-3 py-2.5">
            <RecalcPendingControl
              pending={recalcPending}
              variant="compact"
              onDone={() => setRecalcPending(false)}
            />
          </div>
        ))}

      <div
        className={cn(
          "flex items-center gap-2 border-t border-sidebar-border/60 p-3",
          collapsed && "flex-col justify-center gap-2 p-2"
        )}
      >
        {collapsed ? (
          <>
            {isAdmin && <BalanceChip compact />}
            <AccountChip compact />
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <AccountChip />
            </div>
            {isAdmin && <BalanceChip />}
          </>
        )}
      </div>
    </aside>
  )
}
