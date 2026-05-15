"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { CalculatedScore } from "@/types/domain"
import { ScoreBadge } from "@/components/ui/score-badge"
import { cn } from "@/lib/utils"

interface CalculationBreakdownProps {
  calculatedScore: CalculatedScore
  aiConfidence: number | null
  criteriaCoverage: number
  /** P95 das distâncias do treino. Vem de formula_config.distance_p95. */
  distanceP95?: number | null
}

interface BreakdownStep {
  label: string
  field: keyof CalculatedScore
  description: string
  isStub?: boolean
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const maeToConf = (m: number) => clamp01(1 - m / 10)
const confToMaeEff = (c: number) => Math.max(0.0001, 10 * (1 - c))

function confIA(
  aiConfidence: number | null,
  chaptersNormalized: number | null
): number | null {
  if (aiConfidence == null) return null
  const cpsFactor = clamp01((chaptersNormalized ?? 0) / 10)
  return clamp01(aiConfidence) * cpsFactor
}

function confPr(
  maePredicted: number | null,
  predictedIsStub: boolean,
  coverage: number
): number | null {
  if (predictedIsStub || maePredicted == null) return null
  return maeToConf(maePredicted) * clamp01(coverage)
}

function confFinal(cIa: number | null, cPr: number | null): number | null {
  if (cIa == null && cPr == null) return null
  if (cIa == null) return cPr
  if (cPr == null) return cIa
  const maeIa = confToMaeEff(cIa)
  const maePr = confToMaeEff(cPr)
  const sigma = 1 / Math.sqrt(1 / maeIa ** 2 + 1 / maePr ** 2)
  return maeToConf(sigma)
}

function formatPct(value: number | null): string {
  return value == null ? "N/A" : `${(value * 100).toFixed(0)}%`
}

/**
 * Rótulo qualitativo da distância ao centróide do treino, relativo ao
 * P95 das distâncias do próprio treino (auto-calibra com a base):
 *   - d ≤ P95 × 0.7  →  "perto"
 *   - d ≤ P95        →  "médio"
 *   - d > P95        →  "longe" (outlier por percentil)
 * Quando p95 não está disponível, retorna null (caller exibe só o número).
 */
function distanceLabel(distance: number, p95: number | null | undefined): "perto" | "médio" | "longe" | null {
  if (p95 == null || p95 <= 0) return null
  if (distance <= p95 * 0.7) return "perto"
  if (distance <= p95) return "médio"
  return "longe"
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

export function CalculationBreakdown({
  calculatedScore,
  aiConfidence,
  criteriaCoverage,
  distanceP95,
}: CalculationBreakdownProps) {
  const [open, setOpen] = useState(false)

  const cIa = confIA(aiConfidence, calculatedScore.chapters_normalized)
  const cPr = confPr(
    calculatedScore.mae_predicted,
    calculatedScore.predicted_is_stub,
    criteriaCoverage
  )
  const cFinal = confFinal(cIa, cPr)

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
              const stepConfidence =
                step.field === "calc_score"
                  ? cIa
                  : step.field === "predicted_score"
                    ? cPr
                    : step.field === "final_score"
                      ? cFinal
                      : undefined

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
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{step.label}</p>
                      {stepConfidence !== undefined && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          Conf.: <span className="font-medium text-foreground">{formatPct(stepConfidence)}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              )
            })}

            {/* Parâmetros usados */}
            <div className="mt-4 pt-3 border-t grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">MAE.Calc:</span>{" "}
                {calculatedScore.mae_calc?.toFixed(3) ?? "—"}
              </div>
              <div>
                <span className="font-medium text-foreground">MAE.Prev:</span>{" "}
                {calculatedScore.mae_predicted?.toFixed(3) ?? "—"}
              </div>
              <div
                title={
                  distanceP95 != null
                    ? `Distância Euclidiana nas features padronizadas. Threshold de outlier (P95 do treino): ${distanceP95.toFixed(2)}. Distância acima disso → Nota.Pr pesa menos em Nota.Final.`
                    : "Distância Euclidiana nas features padronizadas. Quanto maior, mais 'fora da distribuição' do treino."
                }
              >
                <span className="font-medium text-foreground">Distância:</span>{" "}
                {calculatedScore.prediction_distance != null
                  ? (() => {
                      const label = distanceLabel(calculatedScore.prediction_distance, distanceP95)
                      return label
                        ? `${calculatedScore.prediction_distance.toFixed(2)} (${label})`
                        : calculatedScore.prediction_distance.toFixed(2)
                    })()
                  : "—"}
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
