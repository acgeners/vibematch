"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setHideAdultContent } from "@/server/actions/settings"

export function HideAdultContentToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setHideAdultContent(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Conteúdo 18+ agora fica oculto." : "Conteúdo 18+ agora aparece normalmente.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, obras <span className="font-medium text-foreground">18+</span> ficam
        desfocadas na página da obra (com botão de revelar) e <span className="font-medium text-foreground">somem das listas</span>{" "}
        — ranking, catálogo, recomendações e favoritos. A marca 🔞 continua visível na obra.
        Desligado por padrão.
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
