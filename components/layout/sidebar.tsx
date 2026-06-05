"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  Heart,
  Upload,
  Trophy,
  Sparkles,
  Settings,
  SlidersHorizontal,
  UserCircle,
  Wand2,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSidebarBadgeCounts } from "@/server/actions/badges"

type BadgeKey = "ai-eval" | "settings"

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
      { href: "/ranking", icon: Trophy, label: "Ranking" },
      { href: "/favorites", icon: Heart, label: "Favoritos" },
      { href: "/recommendations", icon: Wand2, label: "Recomendações" },
    ],
  },
  {
    title: "Gerenciar",
    items: [
      { href: "/conta", icon: UserCircle, label: "Minha conta" },
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
  //   - "ai-eval":  obras nos filtros padrão de /ai-evaluation
  //   - "settings": pendências do Pipeline de dados de /settings
  // Re-busca a cada navegação pra refletir itens processados (ex.: ao sair da
  // página depois de avaliar / rodar manutenção). Falha silenciosa em 0.
  const [badgeCounts, setBadgeCounts] = useState<Record<BadgeKey, number>>({
    "ai-eval": 0,
    settings: 0,
  })
  useEffect(() => {
    let cancelled = false
    getSidebarBadgeCounts()
      .then(({ aiEval, settings }) => {
        if (!cancelled) setBadgeCounts({ "ai-eval": aiEval, settings })
      })
      .catch(() => {
        /* mantém contagens atuais em caso de falha */
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

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
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-[hsl(200_98%_50%)] text-white shadow-md shadow-primary/30 ring-1 ring-white/15">
          <BookOpen className="size-4" />
        </div>
        <div className="min-w-0">
          <span className="block text-base font-bold tracking-tight text-sidebar-foreground">
            VibeMatch
          </span>
          <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Manhwa Library
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

      <div className="border-t border-sidebar-border/60 px-4 py-3">
        <p className="text-[10px] font-medium text-muted-foreground/70">
          v1 · catálogo pessoal
        </p>
      </div>
    </aside>
  )
}
