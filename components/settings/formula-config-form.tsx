"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { updateFormulaConfig } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface FormulaConfigFormProps {
  config: FormulaConfig
}

const schema = z.object({
  mae_calc: z.number().positive(),
  mae_predicted: z.number().positive(),
  pseudo_votes_nota_m: z.number().positive(),
  pseudo_votes_blend: z.number().positive(),
})

type FormValues = z.infer<typeof schema>

const FIELD_INFO: Record<keyof FormValues, { label: string; description: string }> = {
  mae_calc: {
    label: "MAE Nota.IA",
    description: "Erro absoluto médio da Nota.IA (usado no blend final)",
  },
  mae_predicted: {
    label: "MAE Nota.Pr",
    description: "Erro absoluto médio da Nota.Prevista (usado no blend final)",
  },
  pseudo_votes_nota_m: {
    label: "Pseudo-votos Nota.M",
    description: "Votos virtuais para suavizar a média Bayesiana das plataformas",
  },
  pseudo_votes_blend: {
    label: "Pseudo-votos blend",
    description: "Votos virtuais para blend GPT ↔ Nota.M",
  },
}

export function FormulaConfigForm({ config }: FormulaConfigFormProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mae_calc: config.mae_calc ?? undefined,
      mae_predicted: config.mae_predicted ?? undefined,
      pseudo_votes_nota_m: config.pseudo_votes_nota_m,
      pseudo_votes_blend: config.pseudo_votes_blend,
    },
  })

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const onSubmit = async () => {
    if (!pending) return
    setConfirmOpen(false)
    const result = await updateFormulaConfig(pending)

    if ("error" in result && result.error) {
      toast.error("Erro ao salvar configuração")
      return
    }

    toast.success(`Configuração salva! ${(result as { recalculated: number }).recalculated} obras recalculadas.`)
    setPending(null)
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(Object.keys(FIELD_INFO) as (keyof FormValues)[]).map((field) => {
          const info = FIELD_INFO[field]
          return (
            <div key={field} className="space-y-1">
              <Label htmlFor={field}>{info.label}</Label>
              <Input
                id={field}
                type="number"
                step={0.001}
                min={0}
                className="max-w-xs"
                {...register(field, { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">{info.description}</p>
            </div>
          )
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        Versão atual da fórmula:{" "}
        <span className="font-mono font-medium">{config.formula_version}</span>
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? "Salvando e recalculando..." : "Salvar configuração"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar parâmetros da fórmula?"
        description="Os valores serão sobrescritos a cada recálculo. Todas as obras serão recalculadas em seguida."
        confirmText="Salvar e recalcular"
        onConfirm={onSubmit}
      />
    </form>
  )
}
