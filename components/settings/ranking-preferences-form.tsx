"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
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
  top_n: optionalNumber(50),
  // Colunas legadas (min_calc/min_pr/min_final) repurposadas como filtros padrão
  // do ranking — todas persistidas em formula_config, sem migration:
  //   min_final_score      → "Nota Prevista mínima"  (expected_score, 0–10)
  //   min_calc_score       → "Alinhamento mínimo"    (personal_fit, percentil 0–100)
  //   min_predicted_score  → "Veredito IA mínimo"          (alignment_score, 0–100)
  min_final_score: optionalNumber(10),
  min_personal_fit: optionalNumber(100),
  min_alignment: optionalNumber(100),
})

type FormValues = z.infer<typeof schema>

const TOP_N_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50] as const

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
      min_personal_fit: config.min_calc_score,
      min_alignment: config.min_predicted_score,
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
      // Colunas legadas repurposadas (ver schema): Alinhamento → min_calc_score,
      // Veredito IA → min_predicted_score, Nota Prevista → min_final_score.
      min_calc_score: pending.min_personal_fit,
      min_predicted_score: pending.min_alignment,
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
      {/* Top N — botões segmentados compactos (5…30 + Todas) */}
      <Controller
        control={control}
        name="top_n"
        render={({ field }) => {
          const isAll = field.value == null
          return (
            <SettingTile
              label="Mostrar top N obras"
              hint="Quantas obras exibir no ranking."
            >
              <div className="flex flex-wrap gap-1.5">
                {TOP_N_OPTIONS.map((n) => {
                  const selected = !isAll && field.value === n
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => field.onChange(n)}
                      className={cn(
                        "min-w-[2.5rem] rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {n}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                    isAll
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  Todas
                </button>
              </div>
            </SettingTile>
          )
        }}
      />

      {/* Notas mínimas padrão do ranking */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ScoreMinSlider
          control={control}
          name="min_final_score"
          label="Nota Prevista mínima"
          hint="Esconde obras com Nota Prevista abaixo desse valor."
        />
        <PercentMinSlider
          control={control}
          name="min_personal_fit"
          label="Alinhamento mínimo"
          hint="Percentil de alinhamento com seu perfil (0–100). Esconde obras abaixo."
        />
        <PercentMinSlider
          control={control}
          name="min_alignment"
          label="Veredito IA mínimo"
          hint="Re-rank do consultor IA (0–100). Só obras já re-rankeadas têm Veredito IA."
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

function PercentMinSlider({ control, name, label, hint }: ScoreMinSliderProps) {
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
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                  ≥ {numeric}
                </span>
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
              max={100}
              step={5}
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
