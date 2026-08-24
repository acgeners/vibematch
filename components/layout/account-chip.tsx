"use client"

/* eslint-disable @next/next/no-img-element -- avatar pequeno com URL do usuário + fallback próprio; next/image não cabe (sem images config). */

// O `avatarUrl` daqui tem três formas, e as três são só uma URL pro `<img>`:
// vazio (cai no ícone), `/avatar.svg?…` (montado em /account, desenhado pela rota a
// partir da query string) ou a URL do upload no bucket `avatars`. Guardar a
// configuração numa coluna à parte obrigaria este componente a saber montar avatar —
// hoje ele não sabe, e é isso que o mantém trivial. Ver `lib/avatar/url.ts`.

import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpenText, ChevronUp, Clock, Gauge, Info, Loader2, LogIn, LogOut, SlidersHorizontal, Sparkles, Upload, UserCircle, UserPlus } from "lucide-react"
import { getAccountSummary } from "@/server/actions/account"
import type { AccountSummary } from "@/server/queries/current-user"
import { signOutAction } from "@/server/actions/auth"
import { useChromeData } from "@/lib/use-refresh"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { useIsSignedIn, useRole } from "@/components/layout/admin-context"
import { RoleBadge } from "@/components/account/role-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// Mesmos ícones das abas de /account e do item "Preferências" da sidebar — o menu
// não inventa um vocabulário próprio pros mesmos destinos.
// Coisas do USUÁRIO, nunca das obras — é o que separa este menu da barra de cima.
// Importar entrou aqui (e não na console de curadoria) porque o gate virou
// `ensureReadingStateWriter`: importar é ação sobre a SUA lista, não sobre o catálogo.
const MENU_LINKS = [
  { href: "/account", icon: UserCircle, label: "Minha conta" },
  { href: "/account/taste-profile", icon: Sparkles, label: "Perfil de gosto" },
  { href: "/preferences", icon: SlidersHorizontal, label: "Preferências" },
  { href: "/import", icon: Upload, label: "Importar minha lista" },
  { href: "/dashboard", icon: Gauge, label: "Painel de métricas" },
]

/**
 * Chip de conta no rodapé da sidebar: avatar + nome + papel, abrindo um menu com
 * os destinos da conta e o "Sair". Busca o resumo no client (como os badges) e
 * re-busca a cada navegação pra refletir edições feitas em /account. Falha
 * silenciosa → cai pro placeholder.
 */
/**
 * Nome, e-mail e avatar mudam por MUTAÇÃO explícita — e quem as edita já dispara
 * `refreshChrome()` (`components/account/identity-card.tsx`), que força o refetch na hora.
 *
 * 🔴 O TTL era ZERO, ou seja: buscava o perfil a cada navegação, para cima de um dado que
 * quase nunca muda. Com o valor inicial vindo do servidor, isso vira trabalho sem fato por
 * trás. Revalidar por mutação real, não por navegação.
 */
const PERFIL_TTL_MS = 300_000

export function AccountChip({
  compact = false,
  initialProfile,
}: {
  compact?: boolean
  /**
   * Nome, e-mail e avatar já resolvidos no SERVIDOR. Sem isto o chip abria com o ícone neutro
   * e trocava para o avatar quando o POST voltava — o flicker que sobrava depois de `signedIn`
   * e `role` terem ido para o servidor.
   */
  initialProfile: AccountSummary
}) {
  const pathname = usePathname()
  const [summary, setSummary] = useState<AccountSummary | null>(initialProfile)
  const [imgError, setImgError] = useState(false)
  const [signingOut, startSignOut] = useTransition()
  // "Suas notas de IA" mora AQUI e só aqui (antes: também como relógio na barra).
  // O contador tem que aparecer no gatilho — dentro do menu ele só existe pra quem já
  // abriu, e aí o item não convoca ninguém.
  const { recQueue } = useChromeBadges()
  // 🔴 Sessão e papel vêm do CONTEXTO — e agora para TUDO neste componente, não só para o
  // badge da fila. Eles eram lidos daqui E de `summary`, e as duas fontes se contradiziam na
  // tela: medido em 2026-08-23, entre 354ms e 819ms a barra mostrava o avatar do usuário
  // logado (que chega com o `summary`) ao lado do botão "Entrar" (que vinha do contexto,
  // ainda anônimo). 525ms de duas verdades a dois centímetros uma da outra.
  //
  // ⚠️ O contexto é a fonte certa das duas porque é ele que nasce do SERVIDOR (ver
  // `AdminProvider`): está correto no primeiro render, enquanto o `summary` é um POST que
  // chega depois. O `summary` continua dono do que só ele sabe — nome, e-mail, avatar.
  const signedIn = useIsSignedIn()
  const role = useRole()

  // Re-busca o resumo da conta a cada navegação e quando uma mutação atualiza o
  // chrome (ex.: editar perfil/plano em /account). Coalescing/lifecycle no hook.
  // ⚠️ `temDadoInicial`: o mount não refaz o que o servidor entregou. A reconciliação continua
  // — quem edita nome ou avatar em `/account` dispara `refreshChrome()` (ver
  // `components/account/identity-card.tsx`), e é esse evento que traz o valor novo. Revalidar
  // por mutação REAL, não por navegação.
  useChromeData(
    getAccountSummary,
    (s) => {
      setSummary(s)
      setImgError(false)
    },
    PERFIL_TTL_MS,
    undefined,
    true,
  )

  const active = pathname === "/account" || pathname.startsWith("/account/")
  // ⚠️ `loaded` deixou de gatear AÇÃO DE AUTH e passou a significar só "o perfil chegou".
  // A régua antiga existia porque a sessão vinha junto do perfil: sem ele, não dava para
  // saber se havia sessão, e oferecer "Entrar" a quem já entrou mente. Hoje a sessão vem do
  // servidor no primeiro render, então "Entrar"/"Sair" já podem aparecer certos de saída —
  // o que ainda espera é o texto do nome e do e-mail.
  const loaded = summary !== null
  const name = summary?.displayName?.trim() || (!signedIn ? "Visitante" : "Minha conta")
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
          title={compact ? (recQueue > 0 ? `${name} — ${recQueue} nota(s) de IA a revisar` : name) : undefined}
          aria-label={compact ? (recQueue > 0 ? `${name}, ${recQueue} nota(s) de IA a revisar` : name) : undefined}
          className={cn(
            "group relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
            compact && "justify-center gap-0 px-0",
            active || "data-[state=open]:bg-sidebar-accent/70",
            active ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent/80",
          )}
        >
          {avatar()}
          {signedIn && recQueue > 0 && (
            <span
              aria-hidden
              className={cn(
                "inline-flex min-w-[17px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-[17px] text-primary-foreground shadow-sm",
                compact ? "absolute -right-0.5 -top-0.5" : "order-last",
              )}
            >
              {recQueue > 99 ? "99+" : recQueue}
            </span>
          )}
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {name}
              </span>
              {/* O papel é o único lugar SEMPRE visível — sem isto ele fica invisível até
                  alguém abrir /account. Enquanto o resumo não chega, não chuta um papel. */}
              <span className="mt-0.5 block">
                {summary ? (
                  <RoleBadge role={role} size="sm" />
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
            {signedIn && <RoleBadge role={role} size="sm" className="mt-1" />}
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

        {/* Primeiro item, e separado do resto: é o único aqui que pede AÇÃO, e é ele que
            explica o número no gatilho. Continua sendo pendência, não rotina — se virar
            visita frequente, o lugar dela passa a ser um chip próprio na barra. */}
        {signedIn && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/my-ai-scores">
                <Clock />
                <span className="flex-1">Suas notas de IA</span>
                {recQueue > 0 && (
                  <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] font-bold leading-5 text-primary-foreground tabular-nums">
                    {recQueue > 99 ? "99+" : recQueue}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
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

        {signedIn && (
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

        {!signedIn && (
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

        {loaded && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/guide">
                <BookOpenText />
                Guia do app
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/about">
                <Info />
                Sobre a SatorIA
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
