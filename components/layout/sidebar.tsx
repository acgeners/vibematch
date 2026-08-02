"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  BookMarked,
  BookPlus,
  Heart,
  Upload,
  Trophy,
  Wrench,
  Clock,
  Settings,
  SlidersHorizontal,
  Wand2,
  Activity,
  AlertTriangle,
  ChevronLeft,
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SIDEBAR_COLLAPSED_LEGACY_KEY,
  readCollapsedCookie,
  writeCollapsedCookie,
} from "@/lib/sidebar-preference"
import { getSidebarBadgeCounts } from "@/server/actions/badges"
import { useChromeData } from "@/lib/use-refresh"
import { AccountChip } from "@/components/layout/account-chip"
import { BalanceChip } from "@/components/layout/balance-chip"
import { useIsAdmin, useIsSignedIn } from "@/components/layout/admin-context"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { SidebarTasks } from "@/components/tasks/sidebar-tasks"
import { LogoMark } from "@/components/ui/logo-mark"

type BadgeKey = "curadoria" | "rec-queue" | "settings"
// Derivado do retorno da action (evita importar o módulo server-only comix-gate no client).
type ComixHealth = Awaited<ReturnType<typeof getSidebarBadgeCounts>>["comixHealth"]

// Janela mínima entre re-fetches dos badges disparados por navegação. Mutações
// que esvaziam filas forçam o re-fetch na hora (evento global), então a navegação
// não precisa recontar a cada troca de rota (cada chamada ~450ms no DB remoto).
const BADGES_TTL_MS = 30_000

// Colapso do menu do site. As consoles de duas camadas (/settings, /preferencias)
// já têm a própria sub-nav, então o menu recolhe pra trilho ao entrar nelas
// (evita "duas barras"). Fora delas, a escolha manual persiste em cookie
// (lib/sidebar-preference.ts) — o servidor precisa lê-la pra hidratar sem divergir.
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
  // Some do menu pra visitante anônimo (sem sessão) — independe do papel/isAdmin.
  requiresSignedIn?: boolean
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
      { href: "/fila-recomendacao", icon: Clock, label: "Fila de Recomendação", badgeKey: "rec-queue", requiresSignedIn: true },
    ],
  },
  {
    title: "Gerenciar",
    accent: "violet",
    items: [
      { href: "/titles/new", icon: BookPlus, label: "Nova Obra" },
      { href: "/preferencias", icon: SlidersHorizontal, label: "Preferências" },
      { href: "/settings", icon: Settings, label: "Configurações", badgeKey: "settings" },
      { href: "/ai-evaluation", icon: Wrench, label: "Curadoria da Obra", badgeKey: "curadoria" },
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

export function Sidebar({ defaultCollapsed = false }: { defaultCollapsed?: boolean }) {
  const pathname = usePathname()
  const searchParams = useClientSearchParams()
  // Stopgap multi-user: usuário logado (não-dono) é read-only. Esconde a seção
  // GERENCIAR (curadoria/config/import), o saldo Anthropic e o recalc — controles
  // do dono do catálogo. Vê só a navegação de leitura (Principal).
  const isAdmin = useIsAdmin()
  // Itens com `requiresSignedIn` (ex.: Fila de Recomendação) somem pro visitante
  // anônimo — independe do papel, já que o papel de um anônimo também é "leitor".
  const signedIn = useIsSignedIn()
  const sections = (isAdmin ? NAV_SECTIONS : NAV_SECTIONS.filter((s) => s.title !== "Gerenciar"))
    .map((s) => ({ ...s, items: s.items.filter((item) => !item.requiresSignedIn || signedIn) }))

  // Trilho ↔ expandido. O inicial precisa ser IDÊNTICO no servidor e no cliente, senão
  // a hidratação quebra: por isso a preferência vem do cookie (`defaultCollapsed`, lido
  // no layout) e não de localStorage, que o servidor não enxerga. Nas consoles recolhe
  // sempre — derivado do pathname, que o SSR também conhece.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => isConsoleRoute(pathname) || defaultCollapsed,
  )
  // Semeado com o pathname INICIAL. Começando em null, o ajuste-durante-render abaixo
  // disparava já na renderização de hidratação e divergia do HTML do servidor — era
  // exatamente esse o bug (`Hydration failed`). Agora só roda em troca de rota, que é
  // sempre pós-hidratação.
  const [collapseSyncedPath, setCollapseSyncedPath] = useState<string>(() => pathname)
  if (typeof window !== "undefined" && pathname !== collapseSyncedPath) {
    setCollapseSyncedPath(pathname)
    setCollapsed(isConsoleRoute(pathname) ? true : readCollapsedCookie())
  }

  // Migração de quem já tinha a preferência em localStorage: transporta pro cookie uma
  // única vez e apaga a chave antiga. Sem isto, o primeiro load pós-deploy esqueceria a
  // sidebar recolhida de quem a recolheu.
  useEffect(() => {
    const legacy = window.localStorage.getItem(SIDEBAR_COLLAPSED_LEGACY_KEY)
    if (legacy === null) return
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_LEGACY_KEY)
    if (legacy === "1" && !readCollapsedCookie()) {
      writeCollapsedCookie(true)
      setCollapsed(true)
    }
  }, [])

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev
      // Só persiste fora das consoles — nelas o padrão é recolher ao entrar.
      if (!isConsoleRoute(pathname)) {
        writeCollapsedCookie(next)
      }
      return next
    })

  // Badges de pendências (contagens):
  //   - "curadoria": obras NÃO-LIDAS na fila de atributos de /ai-evaluation.
  //   - "rec-queue": obras NÃO-LIDAS em Veredito IA + Interesse de
  //                  /fila-recomendacao, união distinta. As duas eram um badge
  //                  único ("ai-eval") antes da página virar duas.
  //                  "Marcar como lido" em cada página silencia sem resolver →
  //                  o badge some (só é renderizado quando > 0).
  //   - "settings":  pendências do Pipeline de dados de /settings
  // Falha silenciosa em 0.
  const [badgeCounts, setBadgeCounts] = useState<Record<BadgeKey, number>>({
    curadoria: 0,
    "rec-queue": 0,
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
    ({ curadoria, recQueue, settings, recalcPending, comixHealth }) => {
      setBadgeCounts({ curadoria, "rec-queue": recQueue, settings })
      setRecalcPending(recalcPending)
      setComixHealth(comixHealth)
    },
    BADGES_TTL_MS,
    (patch) => {
      // Delta otimista: ex.: avaliar uma obra tira 1 da fila de /ai-evaluation
      // sem re-contar no DB. Clampa em 0 (a navegação reconcilia o exato).
      if (patch.badgeDelta) {
        const { curadoria = 0, recQueue = 0, settings = 0 } = patch.badgeDelta
        setBadgeCounts((prev) => ({
          curadoria: Math.max(0, prev.curadoria + curadoria),
          "rec-queue": Math.max(0, prev["rec-queue"] + recQueue),
          settings: Math.max(0, prev.settings + settings),
        }))
      }
      if (patch.recalcPending != null) setRecalcPending(patch.recalcPending)
    },
  )

  // Prefixo mais específico vence GLOBALMENTE (todas as seções), não só entre irmãos
  // da mesma seção — necessário desde que "/titles/new" (Gerenciar) passou a ser
  // prefixo de "/titles" (Principal): sem isto, os dois acendiam juntos em /titles/new.
  const allItems = sections.flatMap((s) => s.items)
  const isItemActive = (item: NavItem, siblings: NavItem[]): boolean => {
    const basePath = item.href.split("?")[0]
    const pathMatches = basePath === "/" ? pathname === "/" : pathname.startsWith(basePath)
    if (!pathMatches) return false
    if (item.query) {
      return searchParams.get(item.query.key) === item.query.value
    }
    const longerMatchExists = allItems.some((other) => {
      if (other === item) return false
      const otherBase = other.href.split("?")[0]
      return otherBase.length > basePath.length && pathname.startsWith(otherBase)
    })
    if (longerMatchExists) return false
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
        <LogoMark className="size-10 shrink-0 rounded-xl shadow-md shadow-primary/30 ring-1 ring-white/10" />
        {!collapsed && (
          <div className="min-w-0">
            <span className="block text-base font-bold tracking-tight text-sidebar-foreground">
              Sator<span className="text-primary">IA</span>
            </span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-muted-foreground">
              Curadoria à altura
              <br />
              do seu gosto
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
          href="/settings?g=fontes"
          target="_blank"
          rel="noopener noreferrer"
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
