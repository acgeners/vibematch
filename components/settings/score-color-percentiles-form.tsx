"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
import { updateScoreColorPercentiles } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface ScoreColorPercentilesFormProps {
  config: FormulaConfig
}

const DEFAULTS = { top: 80, high: 60, mid: 40, low: 20 }

const schema = z
  .object({
    score_color_pct_top: z.number().min(0).max(100),
    score_color_pct_high: z.number().min(0).max(100),
    score_color_pct_mid: z.number().min(0).max(100),
    score_color_pct_low: z.number().min(0).max(100),
  })
  .refine(
    (v) =>
      v.score_color_pct_low < v.score_color_pct_mid &&
      v.score_color_pct_mid < v.score_color_pct_high &&
      v.score_color_pct_high < v.score_color_pct_top,
    { message: "Os percentis devem ser estritamente crescentes: baixo < médio < alto < topo." }
  )

type FormValues = z.infer<typeof schema>

const ROWS: Array<{
  name: keyof FormValues
  label: string
  hint: string
  swatch: string
}> = [
  {
    name: "score_color_pct_top",
    label: "Topo (verde)",
    hint: "Notas acima desse percentil ficam verdes.",
    swatch: "bg-green-500",
  },
  {
    name: "score_color_pct_high",
    label: "Alto (emerald)",
    hint: "Notas entre esse percentil e o de topo.",
    swatch: "bg-emerald-500",
  },
  {
    name: "score_color_pct_mid",
    label: "Médio (amarelo)",
    hint: "Notas entre esse percentil e o de alto.",
    swatch: "bg-yellow-500",
  },
  {
    name: "score_color_pct_low",
    label: "Baixo (laranja)",
    hint: "Notas entre esse percentil e o médio. Abaixo dele ficam vermelhas.",
    swatch: "bg-orange-500",
  },
]

export function ScoreColorPercentilesForm({ config }: ScoreColorPercentilesFormProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      score_color_pct_top: Number(config.score_color_pct_top),
      score_color_pct_high: Number(config.score_color_pct_high),
      score_color_pct_mid: Number(config.score_color_pct_mid),
      score_color_pct_low: Number(config.score_color_pct_low),
    },
  })

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    if (!pending) return
    setConfirmOpen(false)
    const result = await updateScoreColorPercentiles(pending)
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    reset(pending)
    toast.success("Percentis salvos.")
    setPending(null)
  }

  const resetToDefaults = () => {
    // keepDefaultValues: true preserva os defaultValues originais (os valores
    // salvos) — então o form fica `isDirty` quando os quintis diferem deles,
    // habilitando o botão Salvar. Sem isso, reset zerava o dirty e travava o save.
    reset(
      {
        score_color_pct_top: DEFAULTS.top,
        score_color_pct_high: DEFAULTS.high,
        score_color_pct_mid: DEFAULTS.mid,
        score_color_pct_low: DEFAULTS.low,
      },
      { keepDefaultValues: true }
    )
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Define a posição relativa <strong>em cada coluna</strong> (Nota.Final / Nota.IA / Nota.Pr) acima da qual a nota ganha cada cor.
        Cada coluna usa sua própria distribuição — o mesmo percentil pode resultar em valores de corte diferentes entre elas.
        Defaults = quintis (20/40/60/80), cada cor cobrindo 20% das obras dentro da coluna.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROWS.map((row) => (
          <Controller
            key={row.name}
            control={control}
            name={row.name}
            render={({ field }) => (
              <div className="rounded-lg border border-border/65 bg-background/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`size-3.5 rounded-sm ${row.swatch}`} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{row.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{row.hint}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                    p{Math.round(field.value)}
                  </span>
                </div>
                <Slider
                  value={[field.value]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(v) => field.onChange(v[0])}
                  className="px-1"
                />
              </div>
            )}
          />
        ))}
      </div>

      {errors.root?.message && (
        <p className="text-xs text-destructive">{errors.root.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Salvando..." : "Salvar percentis"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={resetToDefaults}>
          <RotateCcw className="h-3.5 w-3.5" />
          Restaurar defaults
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar percentis de cor?"
        description="As cores das notas agregadas (Nota.Final/IA/Pr) serão recalculadas a partir da distribuição atual do catálogo."
        confirmText="Salvar"
        onConfirm={handleConfirm}
      />
    </form>
  )
}
