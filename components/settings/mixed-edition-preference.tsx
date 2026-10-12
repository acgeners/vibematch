"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setPreferredMixedEdition } from "@/server/actions/settings"
import type { MixedEdition } from "@/lib/editions/mixed-edition"

const OPCOES: Array<{ value: MixedEdition | null; label: string }> = [
  { value: null, label: "Sem preferência" },
  { value: "normal", label: "Versão normal" },
  { value: "r18", label: "Versão R18" },
]

/**
 * Edição padrão das obras que têm versão normal E versão R18 (`mixed`). Sem preferência ⇒ normal.
 * ⚠️ Ocultar 18+ (o controle acima) VENCE esta escolha e força a normal — o texto diz isso, senão
 * escolher "R18" com 18+ oculto pareceria não funcionar.
 */
export function MixedEditionPreference({
  initial,
  hideAdult,
}: {
  initial: MixedEdition | null
  hideAdult: boolean
}) {
  const [value, setValue] = useState<MixedEdition | null>(initial)
  const [pending, startTransition] = useTransition()

  const escolher = (next: MixedEdition | null) => {
    if (next === value) return
    const anterior = value
    setValue(next) // otimista
    startTransition(async () => {
      const res = await setPreferredMixedEdition(next)
      if (res.error) {
        setValue(anterior)
        toast.error(res.error)
      } else {
        toast.success(next === "r18" ? "Obras com duas versões abrem na versão R18." : "Obras com duas versões abrem na versão normal.")
      }
    })
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium text-foreground">Obras com versão normal e versão R18</p>
      <p className="text-sm text-muted-foreground">
        Qual versão abre por padrão. A nota de conteúdo adulto, as tags e os avisos seguem a versão escolhida, e
        você pode trocar em cada obra.
        {hideAdult && " Enquanto obras 18+ estiverem ocultas, a versão normal é a que vale."}
      </p>
      <div role="radiogroup" aria-label="Versão padrão" className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5">
        {OPCOES.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={pending}
            onClick={() => escolher(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              pending && "cursor-not-allowed opacity-60",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
