"use client"

import { useMemo, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Minus, RotateCcw } from "lucide-react"
import { updateScoreWeights } from "@/server/actions/settings"
import type { ScoreWeight } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

interface ScoreWeightsFormProps {
  weights: ScoreWeight[]
  /**
   * Quando true, o form é exibido como read-only — usado pelo modo "pesos
   * automáticos" pra mostrar os valores inferidos sem permitir edição.
   * Sliders ficam disabled; botão "Salvar" some.
   */
  readOnly?: boolean
  /**
   * Confidence por slug (apenas usado quando readOnly=true). Mostra um chip
   * "alta/média/baixa" ao lado do peso pra sinalizar quão estável é a
   * inferência via bootstrap.
   */
  confidenceBySlug?: Record<string, "high" | "medium" | "low">
}

// Bounds generosos: sugestões da IA preservam a magnitude total dos pesos
// (rescaleSuggestions em lib/ml/weight-inference.ts), então valores >20 são
// esperados depois de aplicar sugestões. Manter o schema apertado faz
// "Salvar" virar no-op silencioso.
const WEIGHT_RANGE = 100
const schema = z.object({
  weights: z.array(
    z.object({
      slug: z.string(),
      weight: z.number().min(-WEIGHT_RANGE).max(WEIGHT_RANGE),
      threshold: z.number().min(0).max(10).nullable().optional(),
    })
  ),
})

type FormValues = z.infer<typeof schema>

export function ScoreWeightsForm({ weights, readOnly = false, confidenceBySlug }: ScoreWeightsFormProps) {
  const sorted = useMemo(
    () => [...weights].sort((a, b) => a.display_order - b.display_order),
    [weights]
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    control,
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // Re-sincroniza quando os pesos do servidor mudam (ex.: alternar auto on/off).
    values: {
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
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {sorted.map((w, i) => (
          <CriterionWeightCard
            key={w.slug}
            slug={w.slug}
            index={i}
            control={control}
            register={register}
            readOnly={readOnly}
            confidence={confidenceBySlug?.[w.slug]}
          />
        ))}
      </div>

      {!readOnly && (
        <>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Ao salvar, todas as obras ativas serão recalculadas automaticamente.
          </div>

          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? "Salvando e recalculando..." : "Salvar pesos"}
          </Button>

          {errors.weights && (
            <p className="text-xs text-destructive">
              Algum peso está fora da faixa permitida (±{WEIGHT_RANGE}). Ajuste os valores e tente novamente.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar pesos dos atributos?"
        description="Todas as obras ativas serão recalculadas. A operação pode levar alguns segundos."
        confirmText="Salvar e recalcular"
        onConfirm={onSubmit}
      />
    </form>
  )
}

interface CriterionWeightCardProps {
  slug: string
  index: number
  control: ReturnType<typeof useForm<FormValues>>["control"]
  register: ReturnType<typeof useForm<FormValues>>["register"]
  readOnly?: boolean
  confidence?: "high" | "medium" | "low"
}

function ConfidenceChip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "alta", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
    medium: { label: "média", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
    low: { label: "baixa", cls: "bg-muted/60 text-muted-foreground" },
  }
  const { label, cls } = map[confidence]
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}
      title={`Confiança da inferência: ${label}. Razão sinal/ruído via bootstrap.`}
    >
      {label}
    </span>
  )
}

function CriterionWeightCard({ slug, index, control, register, readOnly, confidence }: CriterionWeightCardProps) {
  const info = CRITERIA_INFO[slug]

  return (
    <Controller
      control={control}
      name={`weights.${index}.weight`}
      render={({ field: weightField }) => {
        const weight = weightField.value ?? 0
        const isNegative = weight < 0
        const isPositive = weight > 0
        const accentBorder = isNegative
          ? "border-rose-500/40"
          : isPositive
            ? "border-primary/40"
            : "border-border/65"
        const accentBg = isNegative
          ? "bg-rose-500/[0.04]"
          : isPositive
            ? "bg-primary/[0.04]"
            : "bg-background/40"
        const chipClasses = isNegative
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
          : isPositive
            ? "bg-primary/15 text-primary"
            : "bg-muted/60 text-muted-foreground"
        const Sign = isNegative ? Minus : isPositive ? Plus : null

        return (
          <div
            className={cn(
              "rounded-lg border p-3 transition-colors",
              accentBorder,
              accentBg
            )}
          >
            <input type="hidden" {...register(`weights.${index}.slug`)} />
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xl leading-none">{info?.emoji ?? "—"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {info?.name ?? slug}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{slug}</p>
              </div>
              {readOnly && confidence && <ConfidenceChip confidence={confidence} />}
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  chipClasses
                )}
                title={isNegative ? "Peso negativo (penaliza)" : "Peso positivo (amplifica)"}
              >
                {Sign && <Sign className="h-3 w-3" />}
                {Math.abs(weight).toFixed(1).replace(".0", "")}
              </span>
            </div>
            <Slider
              value={[weight]}
              min={-WEIGHT_RANGE}
              max={WEIGHT_RANGE}
              step={0.5}
              disabled={readOnly}
              onValueChange={(v) => weightField.onChange(v[0])}
              className={cn(
                "px-1",
                isNegative && "[&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500",
                readOnly && "pointer-events-none opacity-70",
              )}
            />
            <ThresholdField index={index} control={control} weight={weight} readOnly={readOnly} />
          </div>
        )
      }}
    />
  )
}

function ThresholdField({
  index,
  control,
  weight,
  readOnly,
}: {
  index: number
  control: ReturnType<typeof useForm<FormValues>>["control"]
  weight: number
  readOnly?: boolean
}) {
  const isNegative = weight < 0
  return (
    <Controller
      control={control}
      name={`weights.${index}.threshold`}
      render={({ field }) => {
        const hasThreshold = field.value != null
        return (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
            <p className="text-[10px] text-muted-foreground">
              Threshold
              <span className="ml-1 italic">
                ({isNegative ? "piso pra penalizar" : "ponto onde amplifica"})
              </span>
            </p>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step={0.5}
                min={0}
                max={10}
                value={field.value ?? ""}
                disabled={readOnly}
                onChange={(e) => {
                  const v = e.target.value
                  field.onChange(v === "" ? null : Number(v))
                }}
                placeholder="—"
                className={cn(
                  "h-6 w-14 rounded-md border border-input/80 bg-background/70 px-1.5 text-center font-mono text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
                  readOnly && "opacity-70 cursor-not-allowed",
                )}
              />
              {hasThreshold && !readOnly && (
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title="Limpar threshold"
                  aria-label="Limpar threshold"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )
      }}
    />
  )
}
