"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { updateScoreWeights } from "@/server/actions/settings"
import type { ScoreWeight } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface ScoreWeightsFormProps {
  weights: ScoreWeight[]
}

const schema = z.object({
  weights: z.array(
    z.object({
      slug: z.string(),
      weight: z.number().min(-20).max(20),
      threshold: z.number().min(0).max(10).nullable().optional(),
    })
  ),
})

type FormValues = z.infer<typeof schema>

export function ScoreWeightsForm({ weights }: ScoreWeightsFormProps) {
  const sorted = [...weights].sort((a, b) => a.display_order - b.display_order)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      weights: sorted.map((w) => ({
        slug: w.slug,
        weight: w.weight,
        threshold: w.threshold,
      })),
    },
  })

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const onSubmit = async () => {
    if (!pending) return
    setConfirmOpen(false)
    const result = await updateScoreWeights(pending.weights)

    if ("error" in result && result.error) {
      toast.error("Erro ao salvar pesos")
      return
    }

    toast.success(`Pesos salvos! ${(result as { recalculated: number }).recalculated} obras recalculadas.`)
    setPending(null)
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      <div className="overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Critério</TableHead>
              <TableHead>Peso</TableHead>
              <TableHead title="Negativo: piso para penalizar. Positivo: a partir desse valor o impacto é amplificado.">Threshold</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((w, i) => {
              const info = CRITERIA_INFO[w.slug]
              return (
                <TableRow key={w.slug}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{info?.emoji}</span>
                      <div>
                        <p className="font-medium text-sm">{info?.name ?? w.slug}</p>
                        <p className="text-xs text-muted-foreground">{w.slug}</p>
                      </div>
                    </div>
                    <input type="hidden" {...register(`weights.${i}.slug`)} />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step={0.5}
                      className="w-20 h-8 text-sm"
                      {...register(`weights.${i}.weight`, { valueAsNumber: true })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step={0.5}
                      min={0}
                      max={10}
                      placeholder="—"
                      className="w-20 h-8 text-sm"
                      {...register(`weights.${i}.threshold`, {
                        setValueAs: (v) => v === "" || v == null ? null : Number(v),
                      })}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Ao salvar, todas as obras ativas serão recalculadas automaticamente.
      </p>
      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? "Salvando e recalculando..." : "Salvar pesos"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar pesos dos critérios?"
        description="Todas as obras ativas serão recalculadas. A operação pode levar alguns segundos."
        confirmText="Salvar e recalcular"
        onConfirm={onSubmit}
      />
    </form>
  )
}
