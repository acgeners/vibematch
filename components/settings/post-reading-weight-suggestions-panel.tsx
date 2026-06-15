"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Minus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  POST_READING_WEIGHT_LABELS,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import {
  readStoredPostReadingWeights,
  writeStoredPostReadingWeights,
} from "@/lib/post-reading-weights-storage"
import {
  applyPostReadingWeights,
  suggestPostReadingWeights,
} from "@/server/actions/post-reading-weight-suggestions"
import type {
  PostReadingWeightInferenceResult,
  PostReadingWeightSuggestion,
  WeightConfidence,
} from "@/lib/ml/post-reading-weight-inference"
import { cn } from "@/lib/utils"

type Suggestion = PostReadingWeightSuggestion & { selected: boolean }

function confidenceBadge(level: WeightConfidence) {
  if (level === "high") {
    return {
      label: "alta",
      classes: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
      tooltip: "Coeficiente estável entre amostras bootstrap (sinal/ruído ≥ 3).",
    }
  }
  if (level === "medium") {
    return {
      label: "média",
      classes: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
      tooltip: "Coeficiente variável entre amostras bootstrap (sinal/ruído 1.5–3).",
    }
  }
  return {
    label: "baixa",
    classes: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
    tooltip: "Coeficiente muito instável entre amostras (sinal/ruído < 1.5). Tratar com ceticismo.",
  }
}

function DeltaIndicator({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" /> 0
      </span>
    )
  }
  const Icon = delta > 0 ? ArrowUp : ArrowDown
  const color = delta > 0 ? "text-emerald-500" : "text-rose-500"
  const big = Math.abs(delta) >= 2 ? "font-semibold" : ""
  return (
    <span className={cn("inline-flex items-center gap-1", color, big)}>
      <Icon className="h-3 w-3" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}
    </span>
  )
}

export function PostReadingWeightSuggestionsPanel() {
  const [result, setResult] = useState<PostReadingWeightInferenceResult | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [isLoading, startLoading] = useTransition()
  const [isApplying, startApplying] = useTransition()

  const handleSuggest = () => {
    startLoading(async () => {
      try {
        const current = readStoredPostReadingWeights()
        const res = await suggestPostReadingWeights(current)
        setResult(res)
        setSuggestions(
          res.suggestions.map((s) => ({
            ...s,
            selected: s.confidence !== "low" && Math.abs(s.delta) >= 0.5,
          })),
        )
        if (res.isStub) {
          toast.warning(
            `Treino insuficiente (${res.trainSize} obras). Preencha mais avaliações pós-leitura com Nota Prevista calculada.`,
          )
        } else {
          toast.success(
            `Análise concluída. ${res.trainSize} obras avaliadas, cvMAE = ${res.cvMAE}.`,
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao gerar sugestões")
      }
    })
  }

  const handleApply = () => {
    const applies = suggestions.filter(
      (s) => s.selected && s.suggestedWeight !== s.currentWeight,
    )
    if (applies.length === 0) {
      toast.info("Nenhuma sugestão selecionada para aplicar.")
      return
    }

    startApplying(async () => {
      try {
        const current = readStoredPostReadingWeights()
        const next = { ...current }
        for (const s of applies) next[s.field] = s.suggestedWeight
        // Escreve no localStorage primeiro pra que o form e o auto-compute
        // client-side já usem os novos pesos enquanto o recálculo roda.
        writeStoredPostReadingWeights(next)
        const res = await applyPostReadingWeights(next)
        toast.success(
          `${applies.length} pes${applies.length === 1 ? "o aplicado" : "os aplicados"}. ${res.updatedManualScores} nota${res.updatedManualScores === 1 ? "" : "s"} recalculada${res.updatedManualScores === 1 ? "" : "s"}, ${res.recalculated} obras processadas.`,
        )
        setResult(null)
        setSuggestions([])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao aplicar sugestões")
      }
    })
  }

  const toggle = (field: PostReadingScoreField) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.field === field ? { ...s, selected: !s.selected } : s)),
    )
  }

  const updateSuggested = (field: PostReadingScoreField, value: number) => {
    setSuggestions((prev) =>
      prev.map((s) =>
        s.field === field
          ? {
              ...s,
              suggestedWeight: value,
              delta: Math.round((value - s.currentWeight) * 10) / 10,
            }
          : s,
      ),
    )
  }

  const appliedCount = suggestions.filter(
    (s) => s.selected && s.suggestedWeight !== s.currentWeight,
  ).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Treina uma regressão Ridge nos 8 critérios pós-leitura contra a Nota Prevista do sistema
          e sugere pesos que minimizam o erro. Use isso pra descobrir se algum eixo está
          super/subestimado nos seus pesos atuais. Não aplica nada sozinho — você revisa e marca
          o que aceita.
        </p>
        <div className="shrink-0">
          <Button onClick={handleSuggest} disabled={isLoading || isApplying} variant="secondary">
            <Sparkles className="mr-1 h-4 w-4" />
            {isLoading ? "Analisando..." : "Gerar sugestões"}
          </Button>
        </div>
      </div>

      {result?.isStub && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Treino insuficiente — precisa de pelo menos 20 obras com todos os 8 eixos pós-leitura
          preenchidos e Nota Prevista calculada. Atualmente: {result.trainSize}.
        </p>
      )}

      {result && !result.isStub && suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Baseado em {result.trainSize} obras · alpha={result.alpha} ·{" "}
              cvMAE={result.cvMAE.toFixed(3)}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-10"></th>
                  <th className="px-3 py-2 text-left font-medium">Eixo</th>
                  <th className="px-3 py-2 text-right font-medium">Atual</th>
                  <th className="px-3 py-2 text-right font-medium">Sugerido</th>
                  <th className="px-3 py-2 text-right font-medium">Δ</th>
                  <th className="px-3 py-2 text-center font-medium">Confiança</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suggestions.map((s) => {
                  const badge = confidenceBadge(s.confidence)
                  const changed = s.suggestedWeight !== s.currentWeight
                  return (
                    <tr
                      key={s.field}
                      className={cn(
                        "transition-colors",
                        s.selected && changed && "bg-primary/5",
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={s.selected}
                          onChange={() => toggle(s.field)}
                          disabled={!changed}
                          className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">
                          {POST_READING_WEIGHT_LABELS[s.field]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.currentWeight}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          max={10}
                          value={s.suggestedWeight}
                          onChange={(e) =>
                            updateSuggested(s.field, parseFloat(e.target.value) || 0)
                          }
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-right font-mono tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <DeltaIndicator delta={s.delta} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium cursor-help",
                                  badge.classes,
                                )}
                              >
                                {badge.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {badge.tooltip}
                              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                                coef={s.coefficient} ± {s.stderr}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-muted-foreground max-w-md">
              ⚠️ Aplicar recalcula a nota pessoal de todas as obras com pós-leitura preenchido
              e dispara recálculo completo (Nota.Calc e Nota Prevista).
            </p>
            <Button
              onClick={handleApply}
              disabled={isApplying || isLoading || appliedCount === 0}
            >
              {isApplying
                ? "Aplicando..."
                : appliedCount > 0
                  ? `Aplicar ${appliedCount} sugest${appliedCount === 1 ? "ão" : "ões"}`
                  : "Aplicar sugestões"}
            </Button>
          </div>
        </div>
      )}

      {!result && (
        <p className="text-[11px] text-muted-foreground">
          Clique em &quot;Gerar sugestões&quot; para analisar.
        </p>
      )}
    </div>
  )
}
