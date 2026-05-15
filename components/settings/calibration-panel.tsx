"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { recalculateNow } from "@/server/actions/settings"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import type { FormulaConfig } from "@/types/domain"
import type { CalibrationDiff } from "@/lib/calculations/calibration"

interface CalibrationPanelProps {
  config: FormulaConfig
  snapshot: {
    totalWorks: number
    trainSize: number
    maeCalc: number | null
    maePredicted: number | null
    maeFinal: number | null
    rmseCalc: number | null
    rmsePredicted: number | null
    rmseFinal: number | null
    pseudoVotesNotaM: number | null
    pseudoVotesBlend: number | null
    worstDiffs: CalibrationDiff[]
    predictorIsStub: boolean
  }
}

function fmt(value: number | null | undefined, digits = 4): string {
  return value != null && Number.isFinite(value) ? value.toFixed(digits) : "—"
}

function diffClass(value: number | null): string {
  if (value == null) return "text-muted-foreground"
  if (value < 0.5) return "text-emerald-500"
  if (value < 1.0) return "text-amber-500"
  return "text-rose-500"
}

export function CalibrationPanel({ config, snapshot }: CalibrationPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)

  const handleRecalibrate = () => {
    startTransition(async () => {
      try {
        const result = await recalculateNow()
        const cal = result.calibration
        if (cal) {
          setLastRun(
            `${result.recalculated} obras recalculadas. ` +
              `Treino: ${cal.trainSize} títulos, alpha=${cal.alpha}, ` +
              `cvMAE=${fmt(cal.cvMAE, 3)}.`
          )
          toast.success(`Recalibrado. MAE Final: ${fmt(cal.maeFinal, 3)}`)
        } else {
          toast.success(`${result.recalculated} obras recalculadas.`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao recalibrar")
      }
    })
  }

  const hasMismatch = (
    live: number | null,
    stored: number | null,
    threshold = 0.05
  ) => {
    if (live == null || stored == null) return false
    return Math.abs(live - stored) / Math.max(stored, 0.001) > threshold
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Métricas calculadas automaticamente a partir dos {snapshot.totalWorks} títulos
            ativos ({snapshot.trainSize} com nota pessoal).
          </p>
          <p>
            Versão da fórmula: <span className="font-mono">{config.formula_version}</span>
            {snapshot.predictorIsStub && (
              <span className="ml-2 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                Modelo em fallback (precisa de ≥ 20 títulos com M.Nota para Ridge)
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleRecalibrate} disabled={isPending}>
          {isPending ? "Recalibrando..." : "Recalibrar agora"}
        </Button>
      </div>

      {lastRun && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-500">
          {lastRun}
        </p>
      )}

      {/* Métricas de erro (MAE) */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Erro absoluto médio (MAE)</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Equivalente às colunas DiffCalc / DiffPr / DiffFinal da planilha. Calculado sobre
          os títulos com nota pessoal preenchida.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Nota.Calc"
            live={snapshot.maeCalc}
            stored={config.mae_calc}
            mismatch={hasMismatch(snapshot.maeCalc, config.mae_calc)}
          />
          <MetricCard
            label="Nota.Pr"
            live={snapshot.maePredicted}
            stored={config.mae_predicted}
            mismatch={hasMismatch(snapshot.maePredicted, config.mae_predicted)}
          />
          <MetricCard
            label="NotaFinal"
            live={snapshot.maeFinal}
            stored={null}
            mismatch={false}
            note="(informativo)"
          />
        </div>
      </div>

      {/* Pseudo-votos */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Pseudo-votos (percentis de #Votos)</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Suavizam a média Bayesiana. Quanto maior, mais conservador o cálculo para títulos
          com poucos votos.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard
            label="Pseudo Nota.M (p75)"
            live={snapshot.pseudoVotesNotaM}
            stored={config.pseudo_votes_nota_m}
            digits={1}
            mismatch={hasMismatch(snapshot.pseudoVotesNotaM, config.pseudo_votes_nota_m, 0.10)}
          />
          <MetricCard
            label="Pseudo blend (p60)"
            live={snapshot.pseudoVotesBlend}
            stored={config.pseudo_votes_blend}
            digits={1}
            mismatch={hasMismatch(snapshot.pseudoVotesBlend, config.pseudo_votes_blend, 0.10)}
          />
        </div>
      </div>

      {/* Top 10 piores diffs */}
      {snapshot.worstDiffs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">
            Top {snapshot.worstDiffs.length} maiores divergências (NotaFinal vs M.Nota)
          </h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Obra</th>
                  <th className="px-3 py-2 text-right font-medium">M.Nota</th>
                  <th className="px-3 py-2 text-right font-medium">Nota.Calc</th>
                  <th className="px-3 py-2 text-right font-medium">Nota.Pr</th>
                  <th className="px-3 py-2 text-right font-medium">NotaFinal</th>
                  <th className="px-3 py-2 text-right font-medium">DiffFinal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshot.worstDiffs.map((d) => (
                  <tr key={d.workId}>
                    <td className="px-3 py-2 text-xs max-w-[200px]">
                      <WorkTitleLink
                        title={d.title ?? `${d.workId.slice(0, 8)}…`}
                        workId={d.workId}
                        href={d.title ? undefined : `/titles/${d.workId}`}
                        className="hover:underline line-clamp-1 block"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">{d.manualScore.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{d.calcScore?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{d.predictedScore?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{d.finalScore?.toFixed(2) ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-medium ${diffClass(d.diffFinal)}`}>
                      {d.diffFinal?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

interface MetricCardProps {
  label: string
  live: number | null
  stored: number | null
  mismatch: boolean
  digits?: number
  note?: string
}

function MetricCard({ label, live, stored, mismatch, digits = 4, note }: MetricCardProps) {
  return (
    <div
      className={`rounded-md border p-3 ${
        mismatch ? "border-amber-500/40 bg-amber-500/5" : "border-border"
      }`}
    >
      <p className="text-xs text-muted-foreground">
        {label}
        {note && <span className="ml-1 text-[10px] opacity-70">{note}</span>}
      </p>
      <p className="mt-1 font-mono text-base">{fmt(live, digits)}</p>
      {stored != null && (
        <p className="text-[10px] text-muted-foreground">
          Salvo: <span className="font-mono">{fmt(stored, digits)}</span>
          {mismatch && (
            <span className="ml-1 text-amber-500">• desatualizado</span>
          )}
        </p>
      )}
    </div>
  )
}
