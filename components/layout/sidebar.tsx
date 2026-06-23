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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSidebarBadgeCounts } from "@/server/actions/badges"
import { useChromeData } from "@/lib/use-refresh"
import { AccountChip } from "@/components/layout/account-chip"
import { BalanceChip } from "@/components/layout/balance-chip"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { SidebarTasks } from "@/components/tasks/sidebar-tasks"

type BadgeKey = "ai-eval" | "settings"
// Derivado do retorno da action (evita importar o módulo server-only comix-gate no client).
type ComixHealth = Awaited<ReturnType<typeof getSidebarBadgeCounts>>["comixHealth"]

// Janela mínima entre re-fetches dos badges disparados por navegação. Mutações
// que esvaziam filas forçam o re-fetch na hora (evento global), então a navegação
// não precisa recontar a cada troca de rota (cada chamada ~450ms no DB remoto).
const BADGES_TTL_MS = 30_000

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

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Principal",
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

  // Badges de pendências (contagens):
  //   - "ai-eval":  fila de atributos de /ai-evaluation (aba "IA atributos":
  //                 pending + review_pending). As filas Veredito IA / Interesse
  //                 Sinopse têm contadores próprios na página e ficam de fora.
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
    <aside className="relative z-20 hidden min-h-screen w-64 shrink-0 flex-col border-r border-sidebar-border/80 bg-sidebar/95 shadow-[10px_0_30px_hsl(220_30%_5%/0.14)] backdrop-blur md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/70 px-4">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-[hsl(200_98%_50%)] text-white shadow-md shadow-primary/30 ring-1 ring-white/15">
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
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {section.title}
            </p>
            {section.items.map((item) => {
              const { href, icon: Icon, label } = item
              const active = isItemActive(item, section.items)
              const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    active
                      ? "bg-gradient-to-r from-primary/25 via-primary/15 to-primary/5 text-sidebar-foreground shadow-sm shadow-primary/15"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
                      active
                        ? "bg-primary opacity-100 shadow-[0_0_10px_hsl(var(--primary)/0.5)]"
                        : "opacity-0"
                    )}
                  />
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-md transition-colors",
                      active
                        ? "bg-primary/25 text-primary ring-1 ring-primary/30"
                        : "text-sidebar-foreground/55 group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="truncate">{label}</span>
                  {badgeCount > 0 && (
                    <span
                      aria-label={`${badgeCount} ${badgeCount === 1 ? "item" : "itens"} na fila`}
                      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-white/15"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <SidebarTasks />

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
            comixHealth === "down"
              ? "text-rose-500 hover:bg-rose-500/10"
              : "text-amber-500 hover:bg-amber-500/10",
          )}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">
            Comix {comixHealth === "down" ? "fora" : "instável"}
          </span>
        </Link>
      )}

      {recalcPending && (
        <div className="border-t border-sidebar-border/60 px-3 py-2.5">
          <RecalcPendingControl
            pending={recalcPending}
            variant="compact"
            onDone={() => setRecalcPending(false)}
          />
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-sidebar-border/60 p-3">
        <div className="min-w-0 flex-1">
          <AccountChip />
        </div>
        <BalanceChip />
      </div>
    </aside>
  )
}
