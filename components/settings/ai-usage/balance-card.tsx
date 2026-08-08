"use client"

import { Wallet } from "lucide-react"
import { useRefresh } from "@/lib/use-refresh"
import { useState, useTransition } from "react"
import { setAnthropicBalance } from "@/server/actions/account"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { LOW_BALANCE_USD } from "@/lib/ai-usage/balance"
import { formatUsd } from "@/lib/format/money"
import { cn } from "@/lib/utils"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Limiar compartilhado com o ponto do gatilho de Curadoria e o tile da Visão geral.
// Este card mantém os booleanos próprios (ele é o EDITOR do saldo, com estado de
// formulário), mas o NÚMERO tem que ser o mesmo — ver lib/ai-usage/balance.ts.

export function BalanceCard({ status }: { status: BalanceStatus }) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  // Vírgula: o campo fica ao lado do saldo formatado ("$19,96") e o placeholder
  // dele já promete "0,00". `handleSubmit` normaliza os dois separadores, então
  // quem digitar ponto continua funcionando.
  const [value, setValue] = useState(
    status.balanceUsd != null ? String(status.balanceUsd).replace(".", ",") : "",
  )
  const [error, setError] = useState<string | null>(null)

  const hasBalance = status.balanceUsd != null
  const remaining = status.remainingUsd
  const isLow = remaining != null && remaining <= LOW_BALANCE_USD
  const isNegative = remaining != null && remaining < 0

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(value.replace(",", "."))
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Informe um valor válido (≥ 0).")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await setAnthropicBalance(amount)
      if (res.error) {
        setError(res.error)
        return
      }
      refresh()
    })
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card/55 p-4 shadow-sm shadow-black/5 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/20">
            <Wallet className="size-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Saldo Anthropic — restante
            </p>
            <p
              className={cn(
                "mt-1 text-3xl font-bold",
                !hasBalance
                  ? "text-muted-foreground"
                  : isNegative
                    ? "text-rose-600 dark:text-rose-400"
                    : isLow
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground",
              )}
            >
              {hasBalance && remaining != null ? formatUsd(remaining) : "—"}
            </p>
            {hasBalance && status.setAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Informado <span className="font-medium text-foreground">{formatUsd(status.balanceUsd!)}</span>{" "}
                em {formatDateTime(status.setAt)} · gasto desde então{" "}
                <span className="font-medium text-foreground">{formatUsd(status.spentSinceUsd)}</span>{" "}
                ({status.callsSince} {status.callsSince === 1 ? "chamada" : "chamadas"})
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Cole o saldo atual do console da Anthropic pra acompanhar o restante.
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
              disabled={pending}
              aria-label="Saldo Anthropic em USD"
              className="w-28 rounded-lg border border-border/70 bg-background/60 py-1.5 pl-6 pr-2 text-sm tabular-nums text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
            />
          </div>
          {/* Sem gate de "valor igual": reinformar o mesmo saldo é intencional
              (re-sincroniza o "gasto desde então"). Só bloqueia campo vazio. */}
          <button
            type="submit"
            disabled={pending || !value.trim()}
            title={!value.trim() ? "Informe um valor para salvar" : undefined}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Salvando…" : hasBalance ? "Atualizar" : "Salvar"}
          </button>
        </form>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
        Estimativa baseada no custo registrado das chamadas deste app — o saldo real do console
        também drena com uso fora daqui. Reinforme o valor pra re-sincronizar.
      </p>
    </section>
  )
}
