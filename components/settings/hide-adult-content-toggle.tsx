"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setHideAdultContent } from "@/server/actions/settings"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AGE_CONFIRM } from "@/lib/onboarding/age-confirm"

/**
 * Toggle de EXIBIR obras 18+ — ligado = mostrando. Desligar oculta.
 * `initialHidden` é o valor cru de `hide_adult_content` (true = oculto), então o
 * estado visual (`show`) é o inverso. Conta nova começa ocultando (migration 228).
 *
 * LIGAR pede a idade antes, como nas boas-vindas (decisão de 19/11/2026): sem isto, Preferências
 * era o atalho que dispensava a confirmação. Desligar não pergunta nada.
 */
export function HideAdultContentToggle({ initialHidden }: { initialHidden: boolean }) {
  const [show, setShow] = useState(!initialHidden)
  const [pending, startTransition] = useTransition()
  const [askAge, setAskAge] = useState(false)

  const toggle = () => {
    if (!show) {
      setAskAge(true)
      return
    }
    apply(false)
  }

  const apply = (next: boolean) => {
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
    <>
      <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
        <span className="text-sm text-muted-foreground">
          Ligado: obras <span className="font-medium text-foreground">18+</span> aparecem
          normalmente (pede a confirmação de que você tem 18 anos ou mais). Desligue para
          desfocá-las na página da obra (com botão de revelar) e{" "}
          <span className="font-medium text-foreground">tirá-las das listas</span> — ranking,
          catálogo, recomendações e favoritos. A marca 🔞 continua visível na obra.
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
      <ConfirmDialog
        open={askAge}
        onOpenChange={setAskAge}
        title={AGE_CONFIRM.title}
        description={AGE_CONFIRM.text}
        confirmText={AGE_CONFIRM.confirm}
        cancelText={AGE_CONFIRM.cancel}
        onConfirm={() => {
          setAskAge(false)
          apply(true)
        }}
      />
    </>
  )
}
