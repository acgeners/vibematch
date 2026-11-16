"use client"

import { Wallet } from "lucide-react"
import { BalanceForm } from "@/components/settings/ai-usage/balance-form"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { balanceTone } from "@/lib/ai-usage/balance"
import { makeUsdScale } from "@/lib/format/money"
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
  const hasBalance = status.balanceUsd != null
  const remaining = status.remainingUsd
  // Do `balanceTone`, não de um `remaining <= LOW_BALANCE_USD` escrito aqui: o número
  // já era compartilhado, mas a COMPARAÇÃO não era — e foi ela que mudou (`<=` virou
  // `<` quando o limiar caiu pra $2). Duas comparações sobre o mesmo limiar é como
  // este card pinta de âmbar um saldo que o ponto da barra considera folgado.
  const tone = balanceTone(remaining)
  const isLow = tone === "low"
  const isNegative = tone === "negative"

  // Os três números são termos da MESMA conta (informado − gasto = restante) e
  // aparecem colados, então são uma régua só. Com `formatUsd` por valor, o dia em
  // que o saldo é informado saía "Informado $20,00 … gasto desde então 3¢" — dois
  // dígitos "3" que diferem 100× de um lado ao outro de um sinal de menos
  // implícito. O veto de US$1 do `makeUsdScale` mantém tudo em dólar no caso
  // normal; ele só cai pra ¢ quando o próprio saldo é de centavos.
  const usd = makeUsdScale(status.balanceUsd, status.spentSinceUsd, remaining)

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
              {hasBalance && remaining != null ? usd.format(remaining) : "—"}
            </p>
            {hasBalance && status.setAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Informado <span className="font-medium text-foreground">{usd.format(status.balanceUsd!)}</span>{" "}
                em {formatDateTime(status.setAt)} · gasto desde então{" "}
                <span className="font-medium text-foreground">{usd.format(status.spentSinceUsd)}</span>{" "}
                ({status.callsSince} {status.callsSince === 1 ? "chamada" : "chamadas"})
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Cole o saldo atual do console da Anthropic pra acompanhar o restante.
              </p>
            )}
          </div>
        </div>

        <BalanceForm balanceUsd={status.balanceUsd} />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
        Estimativa baseada no custo registrado das chamadas deste app — o saldo real do console
        também drena com uso fora daqui. Reinforme o valor pra re-sincronizar.
      </p>
    </section>
  )
}
