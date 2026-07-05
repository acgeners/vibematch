"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setReviewSummaryEnabled } from "@/server/actions/settings"

export function ReviewSummaryEnabledToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setReviewSummaryEnabled(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Resumo de reviews na síntese: ativado." : "Resumo de reviews na síntese: desativado.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, salvar as reviews de uma obra (na criação ou ao atualizar dados) gera o{" "}
        <span className="font-medium text-foreground">Resumo</span> de consenso via Haiku (consome
        tokens). Desligado, o save persiste as reviews mas não gera o resumo — você gera depois pela
        seção <span className="font-medium text-foreground">Síntese de reviews</span>.
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
