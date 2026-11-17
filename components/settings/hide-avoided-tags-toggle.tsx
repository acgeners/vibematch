"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setHideAvoidedTags } from "@/server/actions/settings"

/**
 * "Esconder as obras com tags que evito" (migration 227). Ligado = esconde. Mesmo desenho do
 * interruptor de 18+ deste mesmo painel. A escolha também aparece nas boas-vindas.
 */
export function HideAvoidedTagsToggle({ initialHidden }: { initialHidden: boolean }) {
  const [hidden, setHidden] = useState(initialHidden)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !hidden
    setHidden(next) // otimista
    startTransition(async () => {
      const res = await setHideAvoidedTags(next)
      if (res.error) {
        setHidden(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Obras com tags que você evita agora ficam escondidas." : "Obras com tags que você evita voltam a aparecer.",
        )
      }
    })
  }

  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">
        Ligado: obras com tags que você <span className="font-medium text-foreground">evita</span> somem do
        ranking, dos favoritos e do “Pra você hoje”. Desligado (padrão): elas aparecem, mais abaixo na ordem.
        Numa visita ao ranking dá para mostrar tudo pelo filtro “Esconder tags evitadas”.
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-label="Esconder as obras com tags que evito"
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          hidden ? "bg-emerald-500" : "bg-muted",
          pending && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white transition-transform",
            hidden ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  )
}
