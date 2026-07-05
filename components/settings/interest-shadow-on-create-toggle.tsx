"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setInterestShadowOnCreate } from "@/server/actions/settings"

/**
 * Liga o arm B (shadow A/B) da Previsão de Interesse na criação — experimento de
 * dev que DOBRA o custo do Interesse. Cor âmbar (não verde) sinaliza "cautela /
 * custo extra". Default desligado.
 */
export function InterestShadowOnCreateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setInterestShadowOnCreate(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Shadow de Interesse na criação: ativado." : "Shadow de Interesse na criação: desativado.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Experimento A/B (dev): roda um <span className="font-medium text-foreground">segundo</span>{" "}
        cálculo de Interesse (Sonnet) na criação pra comparar formulações —{" "}
        <span className="font-medium text-amber-600 dark:text-amber-500">dobra o custo</span> do
        Interesse. Deixe desligado salvo em testes. Também pode ligar pela env{" "}
        <span className="font-medium text-foreground">INTEREST_SHADOW</span>.
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          enabled ? "bg-amber-500" : "bg-muted",
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
