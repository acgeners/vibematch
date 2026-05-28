"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Minus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import {
  suggestScoreWeights,
  applyWeightSuggestions,
  type WeightSuggestionApply,
} from "@/server/actions/weight-suggestions"
import type { WeightInferenceResult, WeightSuggestion } from "@/lib/ml/weight-inference"

interface WeightSuggestionsPanelProps {
  initialLastApplied: string | null
}

type Suggestion = WeightSuggestion & { selected: boolean }

function confidenceBadge(level: WeightSuggestion["confidence"]) {
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
  const big = Math.abs(delta) >= 3 ? "font-semibold" : ""
  return (
    <span className={cn("inline-flex items-center gap-1", color, big)}>
      <Icon className="h-3 w-3" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}
    </span>
  )
}

export function WeightSuggestionsPanel({ initialLastApplied }: WeightSuggestionsPanelProps) {
  const [result, setResult] = useState<WeightInferenceResult | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [isLoading, startLoading] = useTransition()
  const [isApplying, startApplying] = useTransition()
  const [lastApplied, setLastApplied] = useState<string | null>(initialLastApplied)

  const handleSuggest = () => {
    startLoading(async () => {
      try {
        const res = await suggestScoreWeights()
        setResult(res)
        // Por padrão, marca como selecionados apenas os com confiança média/alta
        // E |delta| ≥ 0.5 — evita aplicar mudanças irrelevantes.
        setSuggestions(
          res.suggestions.map((s) => ({
            ...s,
            selected:
              s.confidence !== "low" && Math.abs(s.delta) >= 0.5,
          })),
        )
        if (res.isStub) {
          toast.warning(
            `Treino insuficiente (${res.trainSize} obras). Avalie mais títulos pra desbloquear sugestões.`,
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
    const applies: WeightSuggestionApply[] = suggestions
      .filter((s) => s.selected && s.suggestedWeight !== s.currentWeight)
      .map((s) => ({ slug: s.slug, weight: s.suggestedWeight }))

    if (applies.length === 0) {
      toast.info("Nenhuma sugestão selecionada para aplicar.")
      return
    }

    startApplying(async () => {
      try {
        const res = await applyWeightSuggestions(applies)
        setLastApplied(new Date().toISOString())
        toast.success(
          `${res.appliedCount} pesos aplicados. ${res.recalculated} obras recalculadas.`,
        )
        // Limpa o painel — pesos atuais mudaram, faz sentido o user clicar de novo se quiser.
        setResult(null)
        setSuggestions([])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao aplicar sugestões")
      }
    })
  }

  const toggle = (slug: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.slug === slug ? { ...s, selected: !s.selected } : s)),
    )
  }

  const updateSuggested = (slug: string, value: number) => {
    setSuggestions((prev) =>
      prev.map((s) =>
        s.slug === slug
          ? { ...s, suggestedWeight: value, delta: Math.round((value - s.currentWeight) * 10) / 10 }
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
          Treina uma regressão Ridge nos 9 critérios IA contra suas notas reais (user_score) e
          sugere pesos que minimizam o erro. Use isso pra descobrir se algum critério está
          super/subestimado nos pesos atuais. Não aplica nada sozinho — você revisa e marca o que
          aceita.
        </p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            onClick={handleSuggest}
            disabled={isLoading || isApplying}
            variant="secondary"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {isLoading ? "Analisando..." : "Gerar sugestões"}
          </Button>
          <LastRunHint iso={lastApplied} label="Última aplicação" />
        </div>
      </div>

      {result?.isStub && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Treino insuficiente — precisa de pelo menos 20 obras com nota pessoal e todos os 9
          critérios IA preenchidos. Atualmente: {result.trainSize}.
        </p>
      )}

      {result && !result.isStub && suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Baseado em {result.trainSize} obras avaliadas · alpha={result.alpha} ·{" "}
              cvMAE={result.cvMAE.toFixed(3)}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-10"></th>
                  <th className="px-3 py-2 text-left font-medium">Critério</th>
                  <th className="px-3 py-2 text-right font-medium">Atual</th>
                  <th className="px-3 py-2 text-right font-medium">Sugerido</th>
                  <th className="px-3 py-2 text-right font-medium">Δ</th>
                  <th className="px-3 py-2 text-center font-medium">Confiança</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suggestions.map((s) => {
                  const info = CRITERIA_INFO[s.slug]
                  const badge = confidenceBadge(s.confidence)
                  const changed = s.suggestedWeight !== s.currentWeight
                  return (
                    <tr
                      key={s.slug}
                      className={cn(
                        "transition-colors",
                        s.selected && changed && "bg-primary/5",
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={s.selected}
                          onChange={() => toggle(s.slug)}
                          disabled={!changed}
                          className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden>{info?.emoji ?? ""}</span>
                          <span className="font-medium">{info?.name ?? s.slug}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {s.currentWeight}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step={0.1}
                          value={s.suggestedWeight}
                          onChange={(e) => updateSuggested(s.slug, parseFloat(e.target.value) || 0)}
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
                                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium cursor-help",
                                  badge.classes,
                                )}
                              >
                                {badge.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px]">
                              {badge.tooltip}
                              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
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
              ⚠️ Aplicar pesos dispara recálculo completo (Notas.IA, Calc, Pr, Final). Pesos com
              confiança baixa ou |Δ| &lt; 0.5 vêm desmarcados — revise antes de aplicar.
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
