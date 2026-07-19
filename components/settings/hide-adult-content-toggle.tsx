"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setHideAdultContent } from "@/server/actions/settings"

/**
 * Toggle de EXIBIR obras 18+ — ligado = mostrando (padrão). Desligar oculta.
 * `initialHidden` é o valor cru de `hide_adult_content` (true = oculto), então o
 * estado visual (`show`) é o inverso: começa ligado porque o default é hide=false.
 */
export function HideAdultContentToggle({ initialHidden }: { initialHidden: boolean }) {
  const [show, setShow] = useState(!initialHidden)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !show
    setShow(next) // otimista
    startTransition(async () => {
      const res = await setHideAdultContent(!next) // hide = !show
      if (res.error) {
        setShow(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Obras 18+ agora aparecem normalmente." : "Obras 18+ agora ficam ocultas.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Ligado (padrão): obras <span className="font-medium text-foreground">18+</span> aparecem
        normalmente. Desligue para desfocá-las na página da obra (com botão de revelar) e{" "}
        <span className="font-medium text-foreground">tirá-las das listas</span> — ranking, catálogo,
        recomendações e favoritos. A marca 🔞 continua visível na obra.
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={show}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          show ? "bg-emerald-500" : "bg-muted",
          pending && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white transition-transform",
            show ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  )
}
