"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

type EvaluationFilter = "pending" | "low-confidence" | "outdated-model"

interface AiEvaluationFiltersProps {
  activeFilters: EvaluationFilter[]
  currentModel: string
  currentPromptVersion: string
  currentPromptVersionNum: number
  promptVersionTolerance: number
  lowConfidenceThreshold: number
}

export function AiEvaluationFilters({
  activeFilters,
  currentModel,
  currentPromptVersion,
  currentPromptVersionNum,
  promptVersionTolerance,
  lowConfidenceThreshold,
}: AiEvaluationFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const setFilter = (filter: EvaluationFilter, on: boolean) => {
    const next = new Set(activeFilters)
    if (on) next.add(filter)
    else next.delete(filter)

    const params = new URLSearchParams(searchParams.toString())
    if (next.size === 0 || (next.size === 1 && next.has("pending"))) {
      params.delete("filter")
    } else {
      params.set("filter", [...next].join(","))
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  const isOn = (f: EvaluationFilter) => activeFilters.includes(f)

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Filtros (uma obra que se qualifica em qualquer filtro aparece)
      </p>
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${isPending ? "opacity-60" : ""}`}>
        <FilterToggle
          id="filter-pending"
          checked={isOn("pending")}
          onChange={(v) => setFilter("pending", v)}
          label="Sem avaliação IA"
          description="ai_eval_status = pending"
        />
        <FilterToggle
          id="filter-low-confidence"
          checked={isOn("low-confidence")}
          onChange={(v) => setFilter("low-confidence", v)}
          label={`Confiança < ${Math.round(lowConfidenceThreshold * 100)}%`}
          description="Avaliações de baixa confiança da IA"
        />
        <FilterToggle
          id="filter-outdated"
          checked={isOn("outdated-model")}
          onChange={(v) => setFilter("outdated-model", v)}
          label="Modelo/prompt antigos"
          description={(() => {
            if (promptVersionTolerance <= 0) {
              return `Avaliações em modelo ≠ ${currentModel} ou prompt ≠ ${currentPromptVersion}`
            }
            const cutoff = Math.max(0, currentPromptVersionNum - promptVersionTolerance)
            return `Avaliações em modelo ≠ ${currentModel} ou prompt ≤ v${cutoff} (tolerância ${promptVersionTolerance})`
          })()}
        />
      </div>
    </div>
  )
}

function FilterToggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2 cursor-pointer rounded-md border border-border p-2 hover:bg-muted/40 transition-colors"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer block">
          {label}
        </Label>
        <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  )
}
