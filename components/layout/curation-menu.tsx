"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  Globe,
  Inbox,
  LayoutDashboard,
  Settings,
  Wrench,
} from "lucide-react"
import { getBalanceSummary } from "@/server/actions/account"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { useChromeData } from "@/lib/use-refresh"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** Limiar de "saldo baixo" pra colorir o valor em alerta (espelha o BalanceCard). */
const LOW_BALANCE_USD = 5

/**
 * Janela mínima entre re-fetches do saldo por navegação. O delta otimista das mutações
 * cobre o intervalo; a navegação (passado o TTL) reconcilia a deriva entre custo
 * estimado e faturado.
 */
const BALANCE_TTL_MS = 120_000

function formatUsd(value: number): string {
  const v = Math.abs(value) < 0.005 ? 0 : value
  return `$${v.toFixed(2)}`
}

/**
 * A porta única do catálogo dos outros, na barra superior.
 *
 * Substituiu três alvos soltos de 36px (🔧 curadoria, 💳 saldo, ⚠ Comix) que só tinham
 * em comum o fato de serem do Curador — e nenhum deles dizia o próprio assunto, porque
 * ícone sem rótulo só se explica no `title`, que não existe no toque.
 *
 * 🔴 **O contador do gatilho é a razão de tudo isto poder virar menu.** A regra antiga
 * ("fica como ícone porque dentro de dropdown o número não é visto") continua valendo:
 * o que a resolve é o badge no PRÓPRIO gatilho, somando o que o menu detalha, mais o
 * ponto âmbar quando saldo ou fonte externa pedem atenção. Se o badge sair, os ícones
 * soltos têm que voltar — senão o número deixa de existir pra quem não abre o menu.
 *
 * O vocabulário e as rotas espelham `components/curadoria/console-nav.tsx` de propósito:
 * dois nomes para o mesmo destino é como se descobre, meses depois, que ninguém achava
 * a página.
 */
export function CurationMenu() {
  const pathname = usePathname()
  const { curadoria, requests, comixHealth } = useChromeBadges()
  const [balance, setBalance] = useState<BalanceStatus | null>(null)

  useChromeData(getBalanceSummary, setBalance, BALANCE_TTL_MS, (patch) => {
    if (patch.balanceDeltaUsd == null) return
    setBalance((prev) =>
      prev && prev.remainingUsd != null
        ? { ...prev, remainingUsd: prev.remainingUsd + patch.balanceDeltaUsd! }
        : prev,
    )
  })

  const remaining = balance?.remainingUsd ?? null
  const balanceLow = remaining != null && remaining <= LOW_BALANCE_USD
  const balanceNegative = remaining != null && remaining < 0
  const sourcesDown = comixHealth === "down"
  const sourcesShaky = sourcesDown || comixHealth === "degraded"

  // O badge soma o que o menu detalha: fila de atributos + pedidos do leitor. Somar é o
  // que mantém honesto o "número no gatilho" — um badge que ignorasse os Pedidos deixaria
  // uma decisão pendente invisível para quem não abre o menu.
  const pending = curadoria + requests
  const alerting = balanceLow || sourcesShaky

  const active =
    pathname.startsWith("/curadoria") ||
    pathname.startsWith("/ai-evaluation") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/ai-usage") ||
    pathname.startsWith("/admin/model-metrics")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={pending > 0 ? `Curadoria do catálogo — ${pending} esperando decisão` : "Curadoria do catálogo"}
        aria-label={pending > 0 ? `Curadoria do catálogo, ${pending} esperando decisão` : "Curadoria do catálogo"}
        className={cn(
          "relative inline-flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors",
          "text-violet-600 hover:bg-violet-500/10 data-[state=open]:bg-violet-500/10 dark:text-violet-300",
          active && "bg-violet-500/10",
        )}
      >
        <Wrench className="size-[18px]" />
        <span className="hidden xl:inline">Curadoria</span>
        <ChevronDown className="hidden size-3.5 opacity-60 xl:inline" />
        {pending > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[17px] items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold leading-[17px] text-white shadow-sm">
            {pending > 99 ? "99+" : pending}
          </span>
        )}
        {/* Estado que não é fila não vira número: um ponto basta pra trazer o olho, e o
            valor exato ("$3,10", "Comix instável") aparece na linha do menu. */}
        {alerting && (
          <span
            aria-hidden
            className={cn(
              "absolute bottom-0.5 right-0.5 size-2 rounded-full ring-2 ring-background",
              balanceNegative || sourcesDown ? "bg-rose-500" : "bg-amber-500",
            )}
          />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Catálogo compartilhado
        </DropdownMenuLabel>

        <DropdownMenuItem asChild>
          <Link href="/curadoria">
            <LayoutDashboard />
            <span className="flex-1">Visão geral</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/ai-evaluation">
            <Wrench />
            <span className="flex-1">Curadoria da Obra</span>
            {curadoria > 0 && <MenuCount value={curadoria} tone="violet" />}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/curadoria/pedidos">
            <Inbox />
            <span className="flex-1">Pedidos</span>
            {requests > 0 && <MenuCount value={requests} tone="amber" />}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            <span className="flex-1">Configurações</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Custo e saúde
        </DropdownMenuLabel>

        <DropdownMenuItem asChild>
          <Link href="/ai-usage">
            <Activity />
            <span className="flex-1">Uso da API IA</span>
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                balanceNegative
                  ? "font-bold text-rose-500"
                  : balanceLow
                    ? "font-bold text-amber-500"
                    : "text-muted-foreground",
              )}
            >
              {remaining != null ? formatUsd(remaining) : "definir"}
            </span>
          </Link>
        </DropdownMenuItem>

        {/* Só aparece quando há o que dizer: uma linha "tudo no ar" seria ruído fixo, e o
            destino já está a um clique dentro de Configurações. */}
        {sourcesShaky && (
          <DropdownMenuItem asChild>
            <Link href="/settings?g=fontes">
              <Globe />
              <span className="flex-1">Fontes externas</span>
              <span
                className={cn(
                  "text-xs font-semibold",
                  sourcesDown ? "text-rose-500" : "text-amber-500",
                )}
              >
                {sourcesDown ? "Comix fora do ar" : "Comix instável"}
              </span>
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <Link href="/admin/model-metrics">
            <ChartNoAxesCombined />
            <span className="flex-1">Métricas do modelo</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MenuCount({ value, tone }: { value: number; tone: "violet" | "amber" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 font-mono text-[11px] font-bold leading-5 tabular-nums",
        tone === "violet" ? "bg-violet-500 text-white" : "bg-amber-500 text-amber-950",
      )}
    >
      {value > 99 ? "99+" : value}
    </span>
  )
}
