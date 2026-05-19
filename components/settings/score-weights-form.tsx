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
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {sorted.map((w, i) => (
          <CriterionWeightCard
            key={w.slug}
            slug={w.slug}
            index={i}
            control={control}
            register={register}
          />
        ))}
      </div>

      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Ao salvar, todas as obras ativas serão recalculadas automaticamente.
      </div>

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

interface CriterionWeightCardProps {
  slug: string
  index: number
  control: ReturnType<typeof useForm<FormValues>>["control"]
  register: ReturnType<typeof useForm<FormValues>>["register"]
}

function CriterionWeightCard({ slug, index, control, register }: CriterionWeightCardProps) {
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
              min={-20}
              max={20}
              step={0.5}
              onValueChange={(v) => weightField.onChange(v[0])}
              className={cn("px-1", isNegative && "[&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500")}
            />
            <ThresholdField index={index} control={control} weight={weight} />
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
}: {
  index: number
  control: ReturnType<typeof useForm<FormValues>>["control"]
  weight: number
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
                onChange={(e) => {
                  const v = e.target.value
                  field.onChange(v === "" ? null : Number(v))
                }}
                placeholder="—"
                className="h-6 w-14 rounded-md border border-input/80 bg-background/70 px-1.5 text-center font-mono text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              {hasThreshold && (
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
