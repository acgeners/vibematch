"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Info } from "lucide-react"
import type { CalculatedScore } from "@/types/domain"
import { ScoreBadge } from "@/components/ui/score-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface CalculationBreakdownProps {
  calculatedScore: CalculatedScore
}

/**
 * Waterfall do `expected_score` (L1 novo).
 *
 * Mostra a decomposição persistida (`expected_baseline` + `expected_quality_adj`)
 * em 2 barras visualmente proporcionais ao valor absoluto. Resposta direta à
 * pergunta "por que essa obra recebeu esta nota?":
 *   - Perfil (Stage 1): encaixe com o tipo de obra (9 atributos IA + tags + Nota.M + ...)
 *   - Qualidade (Stage 2): ajuste pelas 8 dimensões pós-leitura (critérios de avaliação)
 *
 * Quando expected_baseline/quality_adj não estão preenchidos (ex.: recalc ainda
 * não rodou após migration 068), mostra fallback informativo.
 */
function ExpectedWaterfall({ calculatedScore }: { calculatedScore: CalculatedScore }) {
  const expected = calculatedScore.expected_score
  const baseline = calculatedScore.expected_baseline
  const qualityAdj = calculatedScore.expected_quality_adj
  const isStub = calculatedScore.expected_is_stub

  if (expected == null) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Nota Prevista ainda não calculada. Rode <strong>Recalcular agora</strong> no{" "}
        <code className="font-mono">/settings</code>.
      </div>
    )
  }

  // Escala visual: maior valor absoluto = 100% da barra
  const maxAbs = Math.max(Math.abs(baseline ?? 0), Math.abs(qualityAdj ?? 0), 0.01)
  const baselineWidth = baseline != null ? (Math.abs(baseline) / maxAbs) * 100 : 0
  const qualityWidth = qualityAdj != null ? (Math.abs(qualityAdj) / maxAbs) * 100 : 0

  const qualitySign = qualityAdj != null && qualityAdj < 0 ? "−" : "+"
  const qualityClass = qualityAdj != null && qualityAdj < 0 ? "bg-rose-500" : "bg-emerald-500"

  return (
    <div className="mt-4 space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          Por que esta nota?
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                A nota prevista é UM Ridge único treinado contra seu user_score em 22 features. A decomposição em <strong>Perfil</strong> (Stage 1: 14 features de encaixe com seu tipo) + <strong>Qualidade</strong> (Stage 2: 8 dimensões pós-leitura) é calculada pós-hoc via atribuição linear (intercept + Σ coef × x agrupado). As 9 notas por critério que alimentam o Perfil vêm da avaliação da IA, que pontua cada critério pelas rubricas (não é o cálculo abaixo). O Perfil já embute uma âncora na Nota.Calc determinística (blend de variância — estabiliza a previsão e dá robustez fora-da-distribuição).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h4>
        <ScoreBadge score={expected} size="sm" showStub={Boolean(isStub)} />
      </div>

      {baseline != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Perfil <span className="text-muted-foreground font-normal">(Stage 1 — encaixe com seu tipo)</span></span>
            <span className="font-mono font-semibold">{baseline.toFixed(2)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-sm bg-muted/30">
            <div className="h-full bg-primary" style={{ width: `${baselineWidth}%` }} />
          </div>
        </div>
      )}

      {/* Stage 2 (Qualidade) só aparece quando há ajuste não-nulo. Hoje as 8
          dimensões pós-leitura NÃO entram no Ridge (qualityAdj ≈ 0 sempre): a
          previsão é 100% Perfil. Mantido condicional caso o plano Pago (L0+)
          reative as features de qualidade. */}
      {qualityAdj != null && Math.abs(qualityAdj) >= 0.005 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">
              Qualidade <span className="text-muted-foreground font-normal">(Stage 2 — ajuste pós-leitura)</span>
            </span>
            <span className={cn("font-mono font-semibold", qualityAdj < 0 ? "text-rose-500" : "text-emerald-500")}>
              {qualitySign}{Math.abs(qualityAdj).toFixed(2)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-sm bg-muted/30">
            <div className={cn("h-full", qualityClass)} style={{ width: `${qualityWidth}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border/40 pt-2 text-xs">
        {baseline != null ? (
          <span className="text-muted-foreground">
            A previsão vem do <strong>Perfil</strong> (encaixe com seu tipo de obra):{" "}
            <span className="font-mono font-semibold text-foreground">{expected.toFixed(2)}</span>
            {qualityAdj != null && Math.abs(qualityAdj) >= 0.005 && (
              <span className="ml-1">
                = {baseline.toFixed(2)} {qualityAdj >= 0 ? "+" : "−"}{" "}
                {Math.abs(qualityAdj).toFixed(2)} (qualidade)
              </span>
            )}
            . As 9 notas por critério (que alimentam o Perfil) vêm da avaliação da
            IA. As 8 dimensões pós-leitura que você preenche NÃO entram na previsão
            — alimentam seu user_score e o ajuste de bias das notas-IA.
          </span>
        ) : (
          <span className="text-muted-foreground">Decomposição completa requer recálculo.</span>
        )}
        <a href="/settings/calibration" className="text-primary hover:underline">
          Ver pesos das features em Configurações › Calibração →
        </a>
      </div>
    </div>
  )
}

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
          {/* Waterfall do expected_score (L1 single Ridge + decomposição via atribuição linear) */}
          <ExpectedWaterfall calculatedScore={calculatedScore} />
        </div>
      )}
    </div>
  )
}
