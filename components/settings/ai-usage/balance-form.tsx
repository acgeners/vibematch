"use client"

import { useState, useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { setAnthropicBalance } from "@/server/actions/account"

/**
 * O formulário que informa o saldo da Anthropic — dono único da validação e da gravação, usado
 * pelo cartão de `/curation/ai-usage` e pelo editor do tile da Visão Geral (`/curation`). Duas
 * cópias divergiriam no detalhe que importa: qual separador decimal aceitar.
 */
export function BalanceForm({
  balanceUsd,
  onSaved,
  autoFocus = false,
}: {
  /** Saldo informado hoje (null = nunca informado). */
  balanceUsd: number | null
  onSaved?: () => void
  autoFocus?: boolean
}) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  // Vírgula: o campo fica ao lado do saldo formatado ("$19,96") e o placeholder já promete
  // "0,00". O envio normaliza os dois separadores, então quem digitar ponto continua funcionando.
  const [value, setValue] = useState(balanceUsd != null ? String(balanceUsd).replace(".", ",") : "")
  const [error, setError] = useState<string | null>(null)

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
      onSaved?.()
    })
  }

  return (
    <div>
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
            autoFocus={autoFocus}
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
          {pending ? "Salvando…" : balanceUsd != null ? "Atualizar" : "Salvar"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
