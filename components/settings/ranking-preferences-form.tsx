"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Infinity as InfinityIcon, RotateCcw } from "lucide-react"
import { updateRankingPreferences } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ScoreBadge } from "@/components/ui/score-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

interface RankingPreferencesFormProps {
  config: FormulaConfig
}

const optionalNumber = (max?: number) =>
  z
    .union([z.number(), z.nan(), z.null()])
    .transform((v) => (v == null || (typeof v === "number" && Number.isNaN(v)) ? null : v))
    .pipe(z.number().min(0).max(max ?? 1_000_000).nullable())

const schema = z.object({
  top_n: optionalNumber(30),
  // Repurposado no cutover Fase 1.5: a coluna min_final_score agora guarda a
  // "Nota Prevista mínima" (filtra expected_score). Os legados min_calc/min_pr
  // saíram da UI e são zerados ao salvar.
  min_final_score: optionalNumber(10),
})

type FormValues = z.infer<typeof schema>

const TOP_N_SLIDER_MAX = 30

export function RankingPreferencesForm({ config }: RankingPreferencesFormProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      top_n: config.top_n,
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
    const result = await updateRankingPreferences({
      top_n: pending.top_n,
      // Legados removidos do pipeline visível — zerados ao salvar.
      min_calc_score: null,
      min_predicted_score: null,
      min_final_score: pending.min_final_score,
    })
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
      {/* Top N — slider with "tudo" toggle */}
      <Controller
        control={control}
        name="top_n"
        render={({ field }) => {
          const isAll = field.value == null
          const displayValue = field.value ?? TOP_N_SLIDER_MAX
          return (
            <SettingTile
              label="Mostrar top N obras"
              hint="Quantas obras exibir no ranking. Desabilitado = todas."
              valueChip={
                isAll ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                    <InfinityIcon className="h-3 w-3" />
                    Todas
                  </span>
                ) : (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                    {field.value}
                  </span>
                )
              }
              action={
                <button
                  type="button"
                  onClick={() => field.onChange(isAll ? 30 : null)}
                  className={cn(
                    "text-[11px] font-medium underline-offset-2 transition-colors hover:underline",
                    isAll ? "text-muted-foreground" : "text-primary"
                  )}
                >
                  {isAll ? "Limitar" : "Mostrar todas"}
                </button>
              }
            >
              <Slider
                value={[isAll ? TOP_N_SLIDER_MAX : displayValue]}
                min={5}
                max={TOP_N_SLIDER_MAX}
                step={5}
                disabled={isAll}
                onValueChange={(v) => field.onChange(v[0])}
                className="px-1"
              />
            </SettingTile>
          )
        }}
      />

      {/* Nota Prevista mínima (única — legados Nota.IA/Pr removidos no cutover) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ScoreMinSlider
          control={control}
          name="min_final_score"
          label="Nota Prevista mínima"
          hint="Esconde obras com Nota Prevista abaixo desse valor."
        />
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

interface ScoreMinSliderProps {
  control: ReturnType<typeof useForm<FormValues>>["control"]
  name: keyof FormValues
  label: string
  hint: string
}

function ScoreMinSlider({ control, name, label, hint }: ScoreMinSliderProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const isUnset = field.value == null
        const numeric = field.value ?? 0
        return (
          <SettingTile
            label={label}
            hint={hint}
            valueChip={
              isUnset ? (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Sem mínimo
                </span>
              ) : (
                <ScoreBadge score={numeric} size="sm" />
              )
            }
            action={
              !isUnset && (
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title="Limpar"
                  aria-label="Limpar"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )
            }
          >
            <Slider
              value={[numeric]}
              min={0}
              max={10}
              step={0.5}
              onValueChange={(v) => field.onChange(v[0] === 0 ? null : v[0])}
              className="px-1"
            />
          </SettingTile>
        )
      }}
    />
  )
}

interface SettingTileProps {
  label: string
  hint?: string
  valueChip?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

function SettingTile({ label, hint, valueChip, action, children }: SettingTileProps) {
  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {valueChip}
          {action}
        </div>
      </div>
      {children}
    </div>
  )
}
