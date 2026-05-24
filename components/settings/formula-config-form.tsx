"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { FormulaConfig } from "@/types/domain"

interface FormulaConfigFormProps {
  config: FormulaConfig
}

interface FieldRow {
  label: string
  tooltip: string
  value: number | null | undefined
  format: (v: number) => string
}

function fmtDecimal(digits: number) {
  return (v: number) => v.toFixed(digits)
}

export function FormulaConfigForm({ config }: FormulaConfigFormProps) {
  const rows: FieldRow[][] = [
    [
      {
        label: "MAE Nota.Calc",
        tooltip:
          "Erro absoluto médio entre Nota.Calc (blend AI + média da plataforma) e sua nota manual. Quanto menor, mais preciso o blend algorítmico.",
        value: config.mae_calc,
        format: fmtDecimal(4),
      },
      {
        label: "MAE Nota.Pr",
        tooltip:
          "Erro absoluto médio entre Nota.Pr (Ridge Regression treinado no seu histórico) e sua nota manual. Quanto menor, mais preciso o preditor aprendido.",
        value: config.mae_predicted,
        format: fmtDecimal(4),
      },
    ],
    [
      {
        label: "RMSE Nota.Calc",
        tooltip:
          "Raiz do erro quadrático médio do Nota.Calc. Usado para pesar Nota.Calc na Nota.Final via inverso da variância (maior RMSE → menor peso).",
        value: config.rmse_calc,
        format: fmtDecimal(4),
      },
      {
        label: "RMSE Nota.Pr (peso em Nota.Final)",
        tooltip:
          "Raiz do erro quadrático médio do Nota.Pr. Usado para pesar Nota.Pr na Nota.Final via inverso da variância.",
        value: config.rmse_predicted,
        format: fmtDecimal(4),
      },
    ],
    [
      {
        label: "Pseudo-votos Nota.M (mediana × 2.0)",
        tooltip:
          "Mediana de #Votos × 2.0. Suaviza a média Bayesiana entre Nota.M (sua) e platform avg. Mais pseudo-votos = mais resistência a obras com poucos votos.",
        value: config.pseudo_votes_nota_m,
        format: fmtDecimal(1),
      },
      {
        label: "Pseudo-votos blend (mediana × 1.2)",
        tooltip:
          "Mediana de #Votos × 1.2. Suaviza o blend interno entre Nota.IA normalizada e média da plataforma dentro do Nota.Calc.",
        value: config.pseudo_votes_blend,
        format: fmtDecimal(1),
      },
    ],
    [
      {
        label: "Distância P95 (threshold de outlier)",
        tooltip:
          "Percentil 95 das distâncias Euclidianas (no espaço de features Ridge) entre pontos de treino. Obras além disso recebem Nota.Pr com peso reduzido pra evitar extrapolação.",
        value: config.distance_p95,
        format: fmtDecimal(3),
      },
    ],
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Valores sobrescritos a cada `recalculateAll`. Edição manual foi removida — qualquer
          alteração seria perdida no próximo recálculo automático.
        </p>

        <div className="space-y-3">
          {rows.map((pair, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pair.map((row) => (
                <ReadOnlyField key={row.label} {...row} />
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            Versão atual da fórmula:{" "}
            <span className="font-mono font-medium">{config.formula_version}</span>
          </div>
          <div className="text-[11px]">
            Incrementada toda vez que você ajusta os pesos em &ldquo;Pesos do Score&rdquo;. Não é
            versão de prompt nem de schema.
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

function ReadOnlyField({ label, tooltip, value, format }: FieldRow) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Info: ${label}`}
              className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <Info className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">{tooltip}</TooltipContent>
        </Tooltip>
      </div>
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm">
        {value != null && Number.isFinite(value) ? format(value) : "—"}
      </p>
    </div>
  )
}
