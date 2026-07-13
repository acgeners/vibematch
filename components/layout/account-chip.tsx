"use client"

/* eslint-disable @next/next/no-img-element -- avatar pequeno com URL do usuário (própria ou colada) + fallback próprio; next/image não cabe (sem images config). */

import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronUp,
  Loader2,
  LogIn,
  LogOut,
  SlidersHorizontal,
  Sparkles,
  UserCircle,
  UserPlus,
} from "lucide-react"
import { getAccountSummary } from "@/server/actions/account"
import type { AccountSummary } from "@/server/actions/account"
import { signOutAction } from "@/server/actions/auth"
import { useChromeData } from "@/lib/use-refresh"
import { RoleBadge } from "@/components/conta/role-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// Mesmos ícones das abas de /conta e do item "Preferências" da sidebar — o menu
// não inventa um vocabulário próprio pros mesmos destinos.
const MENU_LINKS = [
  { href: "/conta", icon: UserCircle, label: "Minha conta" },
  { href: "/conta/perfil", icon: Sparkles, label: "Perfil de gosto" },
  { href: "/preferencias", icon: SlidersHorizontal, label: "Preferências" },
]

/**
 * Chip de conta no rodapé da sidebar: avatar + nome + papel, abrindo um menu com
 * os destinos da conta e o "Sair". Busca o resumo no client (como os badges) e
 * re-busca a cada navegação pra refletir edições feitas em /conta. Falha
 * silenciosa → cai pro placeholder.
 */
export function AccountChip({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname()
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [imgError, setImgError] = useState(false)
  const [signingOut, startSignOut] = useTransition()

  // Re-busca o resumo da conta a cada navegação e quando uma mutação atualiza o
  // chrome (ex.: editar perfil/plano em /conta). Coalescing/lifecycle no hook.
  useChromeData(getAccountSummary, (s) => {
    setSummary(s)
    setImgError(false)
  })

  const active = pathname === "/conta" || pathname.startsWith("/conta/")
  const signedIn = summary?.signedIn ?? false
  // Enquanto o resumo não chega não dá pra saber se há sessão: mostramos os links
  // (inofensivos) mas NENHUMA ação de auth — um "Entrar" piscando pra quem já está
  // logado, ou um "Sair" que não sai, mente sobre o estado da sessão.
  const loaded = summary !== null
  const name = summary?.displayName?.trim() || (loaded && !signedIn ? "Visitante" : "Minha conta")
  // Logado sem email na linha de user_settings: some a linha em vez de inventar um "—".
  const subtitle = signedIn ? summary?.email : "Entre pra salvar seu catálogo"

  const avatar = (className?: string) => (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20 [&_svg]:size-5",
        className,
      )}
    >
      {summary?.avatarUrl && !imgError ? (
        <img
          src={summary.avatarUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <UserCircle />
      )}
    </span>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={compact ? name : undefined}
          aria-label={compact ? name : undefined}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
            compact && "justify-center gap-0 px-0",
            active || "data-[state=open]:bg-sidebar-accent/70",
            active ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent/80",
          )}
        >
          {avatar()}
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {name}
              </span>
              {/* O papel é o único lugar SEMPRE visível — sem isto ele fica invisível até
                  alguém abrir /conta. Enquanto o resumo não chega, não chuta um papel. */}
              <span className="mt-0.5 block">
                {summary ? (
                  <RoleBadge role={summary.role} size="sm" />
                ) : (
                  <span className="block truncate text-[11px] font-medium text-muted-foreground/70">
                    v1 · catálogo pessoal
                  </span>
                )}
              </span>
            </span>
          )}
          {!compact && (
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          )}
        </button>
      </DropdownMenuTrigger>

      {/* Expandida: o chip mora no rodapé, então o menu sobe. Colapsada: não há
          largura pra subir alinhado — abre ao lado do avatar. */}
      <DropdownMenuContent
        side={compact ? "right" : "top"}
        align={compact ? "end" : "start"}
        sideOffset={compact ? 8 : 6}
        className="w-60"
      >
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          {avatar("size-8 [&_svg]:size-4.5")}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            {loaded ? (
              subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : (
              <span className="mt-1 block h-3 w-28 animate-pulse rounded bg-muted" />
            )}
            {summary && <RoleBadge role={summary.role} size="sm" className="mt-1" />}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Sem o resumo não dá pra saber se há sessão — e um menu que nesse meio-tempo
            mostrasse os links SEM o "Sair" pareceria um app sem logout. */}
        {!loaded && (
          <DropdownMenuItem disabled>
            <Loader2 className="animate-spin" />
            Carregando…
          </DropdownMenuItem>
        )}

        {signedIn &&
          MENU_LINKS.map(({ href, icon: Icon, label }) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={href}>
                <Icon />
                {label}
              </Link>
            </DropdownMenuItem>
          ))}

        {loaded && signedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={signingOut}
              onSelect={(e) => {
                // Segura o menu aberto até o redirect do signOutAction: fechar já
                // deixaria a sidebar do usuário logado no ar, sem sinal de que saiu.
                e.preventDefault()
                startSignOut(async () => {
                  await signOutAction()
                })
              }}
            >
              <LogOut />
              {signingOut ? "Saindo…" : "Sair"}
            </DropdownMenuItem>
          </>
        )}

        {loaded && !signedIn && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/login">
                <LogIn />
                Entrar
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/signup">
                <UserPlus />
                Criar conta
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
