"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { BalanceForm } from "@/components/settings/ai-usage/balance-form"

/**
 * Editar o saldo Anthropic sem sair da Visão Geral (pedido de 16/11/2026). O formulário é o mesmo
 * de `/curation/ai-usage` (`BalanceForm`), que segue tendo o detalhe (informado, gasto desde então).
 */
export function BalanceQuickEdit({ balanceUsd }: { balanceUsd: number | null }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Editar o saldo Anthropic"
          title="Editar o saldo"
          className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <p className="mb-2 text-xs text-muted-foreground">Saldo atual no console da Anthropic (USD)</p>
        <BalanceForm balanceUsd={balanceUsd} autoFocus onSaved={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
