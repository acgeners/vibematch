"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { CalculatedScore } from "@/types/domain"
import { ScoreBadge } from "@/components/ui/score-badge"
import { cn } from "@/lib/utils"

interface CalculationBreakdownProps {
  calculatedScore: CalculatedScore
}

interface BreakdownStep {
  label: string
  field: keyof CalculatedScore
  description: string
  isStub?: boolean
}

const STEPS: BreakdownStep[] = [
  {
    label: "IA(n) — Nota bruta IA",
    field: "ia_eval",
    description: "Soma ponderada dos critérios, com penalidades de drama/tragédia aplicadas",
  },
  {
    label: "IA.Norm — IA normalizado",
    field: "ia_eval_normalized",
    description: "IA(n) normalizado para a escala 0–10",
  },
  {
    label: "Nota.M — Plataformas",
    field: "platform_avg",
    description: "Média Bayesiana das plataformas externas (MU, AP, CMX) com pseudo-votos",
  },
  {
    label: "Cps.N — Capítulos norm.",
    field: "chapters_normalized",
    description: "Fator de credibilidade baseado na quantidade de capítulos lidos",
  },
  {
    label: "Nota.IA — Score calculado",
    field: "calc_score",
    description: "Blend entre IA.Norm e Nota.M ponderado por Cps.N e votos das plataformas",
  },
  {
    label: "Nota.Pr — Score previsto",
    field: "predicted_score",
    description: "Nota prevista por modelo ML/Ridge. Se marcado com ~, é estimativa stub",
    isStub: true,
  },
  {
    label: "Nota.Final — Score final",
    field: "final_score",
    description: "Blend final entre Nota.IA e Nota.Pr ponderado pelo MAE de cada componente",
  },
]

export function CalculationBreakdown({ calculatedScore }: CalculationBreakdownProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-muted/50 transition-colors rounded-lg"
      >
        <span>Detalhamento do cálculo</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t px-4 pb-4">
          <div className="mt-4 space-y-3">
            {STEPS.map((step) => {
              const value = calculatedScore[step.field]
              const isStubField = step.isStub && calculatedScore.predicted_is_stub

              return (
                <div
                  key={step.field}
                  className={cn(
                    "flex items-start gap-4 p-3 rounded-md",
                    step.field === "final_score" ? "bg-primary/5 border border-primary/20" : "bg-muted/30"
                  )}
                >
                  <div className="shrink-0 mt-0.5">
                    <ScoreBadge
                      score={typeof value === "number" ? value : null}
                      size="sm"
                      showStub={isStubField}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              )
            })}

            {/* Parâmetros usados */}
            <div className="mt-4 pt-3 border-t grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">MAE.Calc:</span>{" "}
                {calculatedScore.mae_calc.toFixed(3)}
              </div>
              <div>
                <span className="font-medium text-foreground">MAE.Prev:</span>{" "}
                {calculatedScore.mae_predicted.toFixed(3)}
              </div>
              <div>
                <span className="font-medium text-foreground">Total votos:</span>{" "}
                {calculatedScore.total_votes}
              </div>
              <div>
                <span className="font-medium text-foreground">Versão fórmula:</span>{" "}
                {calculatedScore.formula_version}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
