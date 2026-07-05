"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setScoreWeightsAuto } from "@/server/actions/settings"

/**
 * Espelho do toggle "pesos automáticos" que também vive no painel de Calibração
 * automática — os dois leem/gravam a MESMA flag `formula_config.score_weights_auto`.
 * Alternar aqui dispara o recálculo do catálogo inteiro (pode demorar), por isso
 * o botão fica em `pending` até o recálculo voltar. Reverte se falhar.
 */
export function ScoreWeightsAutoToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    const next = !enabled
    setEnabled(next) // otimista
    startTransition(async () => {
      try {
        const result = await setScoreWeightsAuto(next)
        toast.success(
          `${next ? "Pesos automáticos ativados" : "Pesos automáticos desativados"} — ${result.recalculated} obras recalculadas.`,
        )
      } catch (err) {
        setEnabled(!next) // reverte
        toast.error(err instanceof Error ? err.message : "Erro ao alternar pesos automáticos")
      }
    })
  }

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      <span className="text-sm text-muted-foreground">
        Quando ativo, a Nota.IA usa pesos dos 9 atributos{" "}
        <span className="font-medium text-foreground">inferidos do seu histórico</span> de notas;
        desligado, usa os pesos manuais de /preferencias. Alternar recalcula o catálogo inteiro.{" "}
        <span className="font-medium text-foreground">Mesma opção da Calibração automática.</span>
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
