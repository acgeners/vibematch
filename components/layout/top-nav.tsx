"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookMarked,
  BookOpen,
  Clock,
  Heart,
  Home,
  Trophy,
  Wand2,
  Wrench,
  ChevronDown,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { AccountChip } from "@/components/layout/account-chip"
import { BalanceChip } from "@/components/layout/balance-chip"
import { useIsAdmin, useIsSignedIn } from "@/components/layout/admin-context"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { LogoMark } from "@/components/ui/logo-mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface NavLink {
  href: string
  label: string
  icon?: typeof Home
  /** Exige sessão — some inteiro para visitante, em vez de abrir uma página vazia. */
  requiresSignedIn?: boolean
}

interface NavGroup {
  label: string
  /** Um menu só some quando TODOS os filhos somem. */
  items: NavLink[]
  requiresSignedIn?: boolean
}

type NavEntry = NavLink | NavGroup

function isGroup(e: NavEntry): e is NavGroup {
  return "items" in e
}

/**
 * A barra de navegação do app.
 *
 * Substituiu a sidebar de 13 itens em 2026-08-02. A régua que organiza o que entra aqui:
 * **o topo é sobre obras, o avatar é sobre você, a console é sobre o catálogo dos outros.**
 * Por isso Preferências, Importar e Painel não aparecem nesta barra — são do usuário, e
 * moram no menu do avatar; e Configurações/Curadoria/Uso da API são do dono do catálogo.
 *
 * Cinco entradas no máximo. Não existe "Mais ▾" genérico: foi justamente esse balde que
 * reprovou a top nav pura no estudo — enterrava a curadoria dois cliques abaixo de um rótulo
 * que não diz nada. O que não cabe em cinco tem dono claro em outro lugar.
 */
const NAV: NavEntry[] = [
  { href: "/", label: "Início", icon: Home },
  {
    label: "Minha lista",
    requiresSignedIn: true,
    items: [
      { href: "/leitura", label: "Acompanhamento", icon: BookMarked },
      { href: "/favorites", label: "Favoritos", icon: Heart },
      { href: "/fila-recomendacao", label: "Fila de recomendação", icon: Clock },
    ],
  },
  {
    label: "Explorar",
    items: [{ href: "/titles", label: "Catálogo", icon: BookOpen }],
  },
  { href: "/ranking", label: "Ranking", icon: Trophy },
  { href: "/recommendations", label: "Recomendações", icon: Wand2 },
]

function useActive() {
  const pathname = usePathname()
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))
}

export function TopNav() {
  const isAdmin = useIsAdmin()
  const signedIn = useIsSignedIn()
  const isActive = useActive()

  // Contadores do provider — a sidebar da console lê os MESMOS, de um fetch só.
  const { curadoria, recQueue, recalcPending, comixHealth, clearRecalcPending } = useChromeBadges()

  const entries = NAV.filter((e) => !e.requiresSignedIn || signedIn).map((e) =>
    isGroup(e) ? { ...e, items: e.items.filter((i) => !i.requiresSignedIn || signedIn) } : e,
  )

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1560px] items-center gap-2 px-4 md:gap-4 md:px-7">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <LogoMark className="size-9 rounded-xl shadow-md shadow-primary/25 ring-1 ring-white/10" />
          <span className="hidden text-[15px] font-bold tracking-tight sm:block">
            Sator<span className="text-primary">IA</span>
          </span>
        </Link>

        {/* Links: escondidos no mobile, onde a bottom-nav é quem navega. */}
        <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Principal">
          {entries.map((entry) =>
            isGroup(entry) ? (
              <NavMenu key={entry.label} group={entry} isActive={isActive} />
            ) : (
              <Link
                key={entry.href}
                href={entry.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive(entry.href)
                    ? "bg-primary/12 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {entry.label}
              </Link>
            ),
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Ferramentas do dono. Ficam como ÍCONE e não como item de menu porque o que
              importa nelas é o contador — dentro de um dropdown o número não é visto. */}
          {isAdmin && recalcPending && (
            <div className="hidden lg:block">
              <RecalcPendingControl
                pending={recalcPending}
                variant="compact"
                onDone={clearRecalcPending}
              />
            </div>
          )}

          {isAdmin && (comixHealth === "down" || comixHealth === "degraded") && (
            <Link
              href="/settings?g=fontes"
              target="_blank"
              rel="noopener noreferrer"
              title={
                comixHealth === "down"
                  ? "Comix indisponível — avaliações podem rodar sem reviews da Comix."
                  : "Comix instável — algumas reviews da Comix podem faltar."
              }
              className={cn(
                "grid size-9 place-items-center rounded-lg transition-colors",
                comixHealth === "down"
                  ? "text-rose-500 hover:bg-rose-500/10"
                  : "text-amber-500 hover:bg-amber-500/10",
              )}
            >
              <AlertTriangle className="size-4" />
            </Link>
          )}

          {signedIn && (
            <ToolIcon
              href="/fila-recomendacao"
              label="Fila de recomendação"
              count={recQueue}
              tone="primary"
            >
              <Clock className="size-[18px]" />
            </ToolIcon>
          )}

          {/* Aponta pra CONSOLE, não direto pra fila: /settings e /ai-usage também
              moram lá, e desde a remoção da sidebar não tinham mais entrada de menu.
              O contador segue sendo o da fila de atributos — é o único acionável. */}
          {isAdmin && (
            <ToolIcon
              href="/curadoria"
              label="Curadoria do catálogo"
              count={curadoria}
              tone="violet"
            >
              <Wrench className="size-[18px]" />
            </ToolIcon>
          )}

          {isAdmin && <BalanceChip compact />}

          <AccountChip compact />
        </div>
      </div>
    </header>
  )
}

function NavMenu({ group, isActive }: { group: NavGroup; isActive: (h: string) => boolean }) {
  if (group.items.length === 0) return null
  const active = group.items.some((i) => isActive(i.href))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none",
          active
            ? "bg-primary/12 font-semibold text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {group.label}
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {group.items.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>
              {Icon && <Icon />}
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ToolIcon({
  href,
  label,
  count,
  tone,
  children,
}: {
  href: string
  label: string
  count: number
  tone: "primary" | "violet"
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={count > 0 ? `${label} — ${count} na fila` : label}
      aria-label={count > 0 ? `${label}, ${count} na fila` : label}
      className={cn(
        "relative grid size-9 place-items-center rounded-lg transition-colors",
        tone === "violet"
          ? "text-violet-600 hover:bg-violet-500/10 dark:text-violet-300"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
      {count > 0 && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 inline-flex min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[17px] shadow-sm",
            tone === "violet" ? "bg-violet-500 text-white" : "bg-primary text-primary-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )
}

