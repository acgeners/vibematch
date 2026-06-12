"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wallet } from "lucide-react"
import { getBalanceSummary } from "@/server/actions/account"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { useChromeData } from "@/lib/use-refresh"
import { cn } from "@/lib/utils"

// Limiar de "saldo baixo" pra colorir o restante em alerta (espelha BalanceCard).
const LOW_BALANCE_USD = 5

function formatUsd(value: number): string {
  const v = Math.abs(value) < 0.005 ? 0 : value
  return `$${v.toFixed(2)}`
}

/**
 * Chip de saldo Anthropic no rodapé da sidebar: restante estimado, linkando
 * pra /ai-usage (onde se edita o valor). Busca no client (como o AccountChip)
 * e re-busca a cada navegação pra refletir o gasto recente. Falha silenciosa.
 */
export function BalanceChip() {
  const pathname = usePathname()
  const [status, setStatus] = useState<BalanceStatus | null>(null)

  // Re-busca o saldo a cada navegação e quando uma mutação atualiza o chrome
  // (ex.: avaliação IA gastou tokens). Coalescing/lifecycle em useChromeData.
  useChromeData(getBalanceSummary, setStatus)

  const active = pathname === "/ai-usage" || pathname.startsWith("/ai-usage/")
  const hasBalance = status != null && status.remainingUsd != null
  const remaining = status?.remainingUsd ?? null
  const isNegative = remaining != null && remaining < 0
  const isLow = remaining != null && remaining <= LOW_BALANCE_USD

  const tone = isNegative
    ? "text-rose-500"
    : isLow
      ? "text-amber-500"
      : hasBalance
        ? "text-sidebar-foreground"
        : "text-muted-foreground/70"

  return (
    <Link
      href="/ai-usage"
      aria-current={active ? "page" : undefined}
      title={
        hasBalance && remaining != null
          ? `Saldo Anthropic: ${formatUsd(remaining)} restante (estimado)`
          : "Definir saldo Anthropic"
      }
      className={cn(
        "flex shrink-0 flex-col items-end rounded-lg px-2.5 py-1.5 transition-colors",
        active ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent/80",
      )}
    >
      <span className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <Wallet className={cn("size-3", tone)} />
        Saldo
      </span>
      <span className={cn("text-sm font-semibold tabular-nums leading-tight", tone)}>
        {hasBalance && remaining != null ? formatUsd(remaining) : "Definir"}
      </span>
    </Link>
  )
}
