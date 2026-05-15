"use client"

import type { FormulaConfig } from "@/types/domain"

interface FormulaConfigFormProps {
  config: FormulaConfig
}

interface FieldRow {
  label: string
  value: number | null | undefined
  format: (v: number) => string
}

function fmtDecimal(digits: number) {
  return (v: number) => v.toFixed(digits)
}

/**
 * Display read-only de todos os parâmetros calibrados em formula_config.
 * Esses valores são sobrescritos a cada `recalculateAll`, então editar
 * manualmente não fazia sentido (era sempre perdido no próximo recálculo).
 * Mantido como painel de debug pra acompanhar a calibração ao longo do tempo.
 */
export function FormulaConfigForm({ config }: FormulaConfigFormProps) {
  const rows: FieldRow[][] = [
    [
      { label: "MAE Nota.Calc", value: config.mae_calc, format: fmtDecimal(4) },
      { label: "MAE Nota.Pr", value: config.mae_predicted, format: fmtDecimal(4) },
    ],
    [
      { label: "RMSE Nota.Calc", value: config.rmse_calc, format: fmtDecimal(4) },
      { label: "RMSE Nota.Pr (peso em Nota.Final)", value: config.rmse_predicted, format: fmtDecimal(4) },
    ],
    [
      { label: "GPT mean (z-score)", value: config.gpt_mean, format: fmtDecimal(4) },
      { label: "GPT std (z-score)", value: config.gpt_std, format: fmtDecimal(4) },
    ],
    [
      { label: "Pseudo-votos Nota.M (mediana × 2.0)", value: config.pseudo_votes_nota_m, format: fmtDecimal(1) },
      { label: "Pseudo-votos blend (mediana × 1.2)", value: config.pseudo_votes_blend, format: fmtDecimal(1) },
    ],
  ]

  return (
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

      <div className="text-xs text-muted-foreground">
        Versão atual da fórmula:{" "}
        <span className="font-mono font-medium">{config.formula_version}</span>
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value, format }: FieldRow) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm">
        {value != null && Number.isFinite(value) ? format(value) : "—"}
      </p>
    </div>
  )
}
