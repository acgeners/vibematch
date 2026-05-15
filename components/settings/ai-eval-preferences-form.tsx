"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { updateAiEvalPreferences } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface AiEvalPreferencesFormProps {
  config: FormulaConfig
  currentPromptVersion: string
  currentPromptVersionNum: number
}

const schema = z.object({
  prompt_version_tolerance: z.number().int().min(0).max(50),
})

type FormValues = z.infer<typeof schema>

export function AiEvalPreferencesForm({
  config,
  currentPromptVersion,
  currentPromptVersionNum,
}: AiEvalPreferencesFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      prompt_version_tolerance: Math.max(0, config.prompt_version_tolerance ?? 0),
    },
  })

  const currentTolerance = Number(watch("prompt_version_tolerance") ?? 0)
  const cutoff = Math.max(0, currentPromptVersionNum - (Number.isFinite(currentTolerance) ? currentTolerance : 0))

  const onSubmit = async (values: FormValues) => {
    const result = await updateAiEvalPreferences(values)
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    reset(values)
    toast.success("Tolerância salva.")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1 max-w-xs">
        <Label htmlFor="prompt_version_tolerance">Tolerância de versão de prompt</Label>
        <Input
          id="prompt_version_tolerance"
          type="number"
          min={0}
          max={50}
          step={1}
          {...register("prompt_version_tolerance", { valueAsNumber: true })}
        />
        <p className="text-xs text-muted-foreground">
          Quantas versões pra trás contam como atualizado. Versão atual:{" "}
          <span className="font-mono font-medium">{currentPromptVersion}</span>.{" "}
          {currentTolerance > 0
            ? `Com tolerância ${currentTolerance}, obras avaliadas em v${cutoff + 1}+ são consideradas atualizadas (obras em ≤ v${cutoff} aparecem no filtro "Modelo/prompt antigos").`
            : `Com tolerância 0, qualquer versão diferente de ${currentPromptVersion} é tratada como desatualizada.`}
        </p>
      </div>

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? "Salvando..." : "Salvar tolerância"}
      </Button>
    </form>
  )
}
