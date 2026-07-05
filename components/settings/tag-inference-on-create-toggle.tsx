"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setTagInferenceOnCreate } from "@/server/actions/settings"

export function TagInferenceOnCreateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      const res = await setTagInferenceOnCreate(next)
      if (res.error) {
        setEnabled(!next) // reverte
        toast.error(res.error)
      } else {
        toast.success(
          next ? "Inferência de tags na criação: ativada." : "Inferência de tags na criação: desativada.",
        )
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, criar uma obra já infere tags por IA via Haiku a partir da sinopse e das
        reviews (consome tokens), gravando-as como{" "}
        <span className="font-medium text-foreground">ai_inferred</span>. Desligado, a obra nasce{" "}
        <span className="font-medium text-foreground">sem tags inferidas</span> e você as gera depois.
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
