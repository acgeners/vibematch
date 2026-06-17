"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Info } from "lucide-react"
import type { CalculatedScore } from "@/types/domain"
import { ScoreBadge } from "@/components/ui/score-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface CalculationBreakdownProps {
  calculatedScore: CalculatedScore
}

/**
 * Explicador do `expected_score` (Nota Prevista, L1 single Ridge).
 *
 * Responde "por que essa obra recebeu esta nota?" descrevendo o pipeline REAL:
 * um Ridge único sobre ~22 features, blendado com a Nota.Calc determinística e
 * ajustado por um nudge manual de observação. A antiga decomposição em
 * Perfil (Stage 1) + Qualidade (Stage 2) foi removida (§6 Bloco 2): a
 * arquitetura 2-stage está aposentada (L0_QUALITY_ENABLED=false → qualityAdj
 * sempre 0), então as 2 barras eram degeneradas/enganosas. Os pesos por
 * feature vivem em Configurações › Calibração.
 */
function ExpectedExplainer({ calculatedScore }: { calculatedScore: CalculatedScore }) {
  const expected = calculatedScore.expected_score
  const isStub = calculatedScore.expected_is_stub

  if (expected == null) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Nota Prevista ainda não calculada. Rode <strong>Recalcular agora</strong> no{" "}
        <code className="font-mono">/settings</code>.
      </div>
    )
  }

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
                A Nota Prevista é UM Ridge (regressão linear regularizada) treinado contra o seu user_score em ~22 features. A saída é blendada com a Nota.Calc determinística (blend de variância — estabiliza a previsão e dá robustez fora-da-distribuição) e recebe um nudge manual de observação (±0,30) quando você define um. As 9 notas por critério que entram como features vêm da avaliação da IA (que pontua cada critério pelas rubricas), não do cálculo aqui.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h4>
        <ScoreBadge score={expected} size="sm" showStub={Boolean(isStub)} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <span>
          A previsão sai de <strong>um Ridge único</strong> sobre ~22 features do seu perfil e da
          obra: os 9 atributos da IA, a Nota.M e os votos do público, capítulos, interesse na
          sinopse, overlap de tags que você ama/evita, fit de critério, era e duração, status de
          publicação e país de origem. O resultado é ancorado na <strong>Nota.Calc</strong>{" "}
          determinística (blend de variância) e ajustado por um nudge manual de observação quando há.
        </span>
        <span>
          As 8 dimensões pós-leitura que você preenche <strong>não</strong> entram na previsão —
          alimentam o seu user_score e o ajuste de bias das notas-IA.
        </span>
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
          {/* Explicador do expected_score (L1 single Ridge + âncora na Nota.Calc) */}
          <ExpectedExplainer calculatedScore={calculatedScore} />
        </div>
      )}
    </div>
  )
}
