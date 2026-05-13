"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { updateRankingPreferences } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface RankingPreferencesFormProps {
  config: FormulaConfig
}

const optionalNumber = (max?: number) =>
  z
    .union([z.number(), z.nan(), z.null()])
    .transform((v) => (v == null || (typeof v === "number" && Number.isNaN(v)) ? null : v))
    .pipe(z.number().min(0).max(max ?? 1_000_000).nullable())

const schema = z.object({
  top_n: optionalNumber(10000),
  min_calc_score: optionalNumber(10),
  min_predicted_score: optionalNumber(10),
  min_final_score: optionalNumber(10),
})

type FormValues = z.infer<typeof schema>

const numberOrNull = (v: unknown): number | null => {
  if (v === "" || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function RankingPreferencesForm({ config }: RankingPreferencesFormProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      top_n: config.top_n,
      min_calc_score: config.min_calc_score,
      min_predicted_score: config.min_predicted_score,
      min_final_score: config.min_final_score,
    },
  })

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    if (!pending) return
    setConfirmOpen(false)
    const result = await updateRankingPreferences(pending)
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    reset(pending)
    toast.success("Preferências salvas.")
    setPending(null)
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="top_n">Mostrar top N</Label>
          <Input
            id="top_n"
            type="number"
            min={1}
            max={10000}
            step={1}
            placeholder="Todas"
            className="max-w-xs"
            {...register("top_n", { setValueAs: numberOrNull })}
          />
          <p className="text-xs text-muted-foreground">
            Quantas obras exibir no ranking. Vazio = todas.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="min_final_score">Nota mínima — Nota.Final</Label>
          <Input
            id="min_final_score"
            type="number"
            min={0}
            max={10}
            step={0.1}
            placeholder="Sem mínimo"
            className="max-w-xs"
            {...register("min_final_score", { setValueAs: numberOrNull })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="min_calc_score">Nota mínima — Nota.IA</Label>
          <Input
            id="min_calc_score"
            type="number"
            min={0}
            max={10}
            step={0.1}
            placeholder="Sem mínimo"
            className="max-w-xs"
            {...register("min_calc_score", { setValueAs: numberOrNull })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="min_predicted_score">Nota mínima — Nota.Pr</Label>
          <Input
            id="min_predicted_score"
            type="number"
            min={0}
            max={10}
            step={0.1}
            placeholder="Sem mínimo"
            className="max-w-xs"
            {...register("min_predicted_score", { setValueAs: numberOrNull })}
          />
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? "Salvando..." : "Salvar preferências"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar preferências de ranking?"
        description="Os filtros de exibição do ranking serão atualizados. As notas em si não serão recalculadas."
        confirmText="Salvar"
        onConfirm={handleConfirm}
      />
    </form>
  )
}
