"use client"

import { useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Gauge } from "lucide-react"
import { updateAiEvalPreferences } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

interface AiEvalPreferencesFormProps {
  config: FormulaConfig
  currentPromptVersion: string
  currentPromptVersionNum: number
}

const schema = z.object({
  prompt_version_tolerance: z.number().int().min(0).max(50),
  low_confidence_threshold_pct: z.number().int().min(0).max(100),
})

type FormValues = z.infer<typeof schema>

export function AiEvalPreferencesForm({
  config,
  currentPromptVersion,
  currentPromptVersionNum,
}: AiEvalPreferencesFormProps) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      prompt_version_tolerance: Math.max(0, config.prompt_version_tolerance ?? 0),
      low_confidence_threshold_pct: Math.round(
        Math.min(1, Math.max(0, config.low_confidence_threshold ?? 0.8)) * 100
      ),
    },
  })

  const tolerance = Number(useWatch({ control, name: "prompt_version_tolerance" }) ?? 0)
  const cutoff = Math.max(0, currentPromptVersionNum - tolerance)
  const thresholdPct = Number(useWatch({ control, name: "low_confidence_threshold_pct" }) ?? 80)

  const onSubmit = async (values: FormValues) => {
    const result = await updateAiEvalPreferences({
      prompt_version_tolerance: values.prompt_version_tolerance,
      low_confidence_threshold: values.low_confidence_threshold_pct / 100,
    })
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    reset(values)
    toast.success("Preferências salvas.")
  }

  const thresholdTone =
    thresholdPct >= 75
      ? "text-emerald-600 dark:text-emerald-300"
      : thresholdPct >= 50
        ? "text-amber-600 dark:text-amber-300"
        : "text-rose-600 dark:text-rose-300"

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Tolerância de versão de prompt */}
        <Controller
          control={control}
          name="prompt_version_tolerance"
          render={({ field }) => (
            <div className="rounded-lg border border-border/65 bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Tolerância de versão de prompt
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Quantas versões pra trás contam como atualizadas. Atual:{" "}
                    <span className="font-mono font-medium text-foreground">{currentPromptVersion}</span>.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                  {tolerance === 0 ? "Sem tolerância" : `±${tolerance}`}
                </span>
              </div>
              <Slider
                value={[field.value]}
                min={0}
                max={10}
                step={1}
                onValueChange={(v) => field.onChange(v[0])}
                className="px-1"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {tolerance > 0
                  ? `Obras em v${cutoff + 1}+ contam como atualizadas. v${cutoff} ou abaixo entram no filtro de "Modelo/prompt antigos".`
                  : `Qualquer versão diferente de ${currentPromptVersion} é tratada como desatualizada.`}
              </p>
            </div>
          )}
        />

        {/* Threshold de baixa confiança */}
        <Controller
          control={control}
          name="low_confidence_threshold_pct"
          render={({ field }) => (
            <div className="rounded-lg border border-border/65 bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Threshold de baixa confiança
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Avaliações IA com confiança abaixo desse valor entram no filtro de revisão.
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
                    thresholdPct >= 75
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : thresholdPct >= 50
                        ? "border-amber-400/30 bg-amber-500/10"
                        : "border-rose-400/30 bg-rose-500/10",
                    thresholdTone
                  )}
                >
                  <Gauge className="h-3 w-3" />
                  {thresholdPct}%
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
              <p className="mt-2 text-[11px] text-muted-foreground">
                Obras com confiança IA <span className={`font-semibold ${thresholdTone}`}>&lt; {thresholdPct}%</span> aparecem em <span className="font-mono">/ai-evaluation</span>.
              </p>
            </div>
          )}
        />
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? "Salvando..." : "Salvar preferências"}
      </Button>
    </form>
  )
}
