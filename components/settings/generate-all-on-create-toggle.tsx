"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setGenerateAllOnCreate } from "@/server/actions/settings"

export function GenerateAllOnCreateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setGenerateAllOnCreate(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Gerar todos os dados na criação: ativado." : "Gerar todos os dados na criação: desativado.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, criar uma obra agenda a cascata que gera{" "}
        <span className="font-medium text-foreground">todos os dados</span> em ordem (sinopse, reviews,
        tags, 9 atributos, Nota Prevista, Interesse, Veredito e embedding). Passa por um gate de fontes
        (Comix + ComicK) e pede <span className="font-medium text-foreground">autorização de custo</span>{" "}
        (~$0,13/obra) antes de gastar. Desligado, a obra nasce com o fluxo leve de hoje.
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
