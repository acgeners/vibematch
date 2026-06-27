"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setSynopsisCanonicalOnCreate } from "@/server/actions/settings"

export function SynopsisCanonicalOnCreateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setSynopsisCanonicalOnCreate(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Sinopse canônica na criação: ativada." : "Sinopse canônica na criação: desativada.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, criar uma obra já consolida a sinopse canônica via Haiku (consome tokens).
        Desligado, a obra nasce <span className="font-medium text-foreground">sem canônica</span> e
        você gera depois — pelo painel acima, ou ao editar/atualizar os dados da obra.
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          enabled ? "bg-emerald-500" : "bg-muted",
          pending && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  )
}
