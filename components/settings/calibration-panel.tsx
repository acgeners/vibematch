"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { recalculateNow, setStackerEnabled } from "@/server/actions/settings"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { cn } from "@/lib/utils"
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
    distanceBuckets: Array<{ label: string; count: number }>
    worksWithDistance: number
  }
}

const CRITERIA_LABEL: Record<string, string> = {
  drama: "Drama",
  tragedy: "Tragédia",
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "nunca"
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "agora há pouco"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `há ${days}d`
  return date.toLocaleDateString("pt-BR")
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
  const [isTogglingStacker, startStackerToggle] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)
  // formatRelativeTime depende de Date.now(), que difere entre server-render
  // e client-hydrate — evita hydration mismatch renderizando "—" no SSR e
  // populando depois do mount. Atualiza a cada 30s pra ficar live.
  const [relativeTime, setRelativeTime] = useState<string>("—")
  useEffect(() => {
    const update = () => setRelativeTime(formatRelativeTime(config.last_recalculated_at))
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [config.last_recalculated_at])

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

  const handleToggleStacker = (next: boolean) => {
    startStackerToggle(async () => {
      try {
        const result = await setStackerEnabled(next)
        toast.success(
          `Stacker ${next ? "ativado" : "desativado"}. MAE Final: ${fmt(
            result.calibration?.maeFinal ?? null,
            3,
          )}`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao alternar stacker")
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
        <div className="flex flex-col items-end gap-1">
          <Button onClick={handleRecalibrate} disabled={isPending}>
            {isPending ? "Recalibrando..." : "Recalibrar agora"}
          </Button>
          <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
            Último recálculo: {relativeTime}
          </span>
        </div>
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
        <h3 className="mb-2 text-sm font-medium">Pseudo-votos (mediana × multiplicador)</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Suavizam a média Bayesiana. Recalculados automaticamente após cada edição de título.
          O badge &quot;desatualizado&quot; aparece quando a fórmula de cálculo mudou e o recálculo
          ainda não rodou — clique em &quot;Recalibrar agora&quot; pra sincronizar.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard
            label="Pseudo Nota.M (mediana × 2.0)"
            live={snapshot.pseudoVotesNotaM}
            stored={config.pseudo_votes_nota_m}
            digits={1}
            mismatch={hasMismatch(snapshot.pseudoVotesNotaM, config.pseudo_votes_nota_m, 0.10)}
          />
          <MetricCard
            label="Pseudo blend (mediana × 1.2)"
            live={snapshot.pseudoVotesBlend}
            stored={config.pseudo_votes_blend}
            digits={1}
            mismatch={hasMismatch(snapshot.pseudoVotesBlend, config.pseudo_votes_blend, 0.10)}
          />
        </div>
      </div>

      {/* Diagnósticos do último recálculo */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Diagnósticos do último recálculo</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Valores persistidos pelo `recalculateAll`. Útil pra detectar regressões silenciosas
          (e.g. clamp disparando demais, critérios negativos nunca ativando).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Clamp 0–10 em Nota.IA (GPT)</p>
            <p className="mt-1 font-mono text-base">
              {config.gpt_clamp_hit_rate != null
                ? `${(config.gpt_clamp_hit_rate * 100).toFixed(1)}%`
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {config.gpt_clamp_hit_rate != null && config.gpt_clamp_hit_rate > 0.2
                ? "alto: o bônus pode estar empurrando obras pra fora da escala"
                : "abaixo de 20% = saudável"}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Critérios negativos ativados</p>
            <div className="mt-1 space-y-1">
              {config.negative_activation_rate && Object.keys(config.negative_activation_rate).length > 0 ? (
                Object.entries(config.negative_activation_rate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([slug, rate]) => (
                    <p key={slug} className="font-mono text-xs">
                      {CRITERIA_LABEL[slug] ?? slug}:{" "}
                      <span className="text-foreground">{(rate * 100).toFixed(1)}%</span>
                    </p>
                  ))
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Fração de obras com score acima do threshold negativo.
            </p>
          </div>
        </div>
      </div>

      {/* Stacker (Ridge segundo-nível) */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-sm font-medium">Stacker (Ridge segundo-nível)</h3>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <span className="text-muted-foreground">
              {config.stacker_enabled ? "Ativo" : "Desativado"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={config.stacker_enabled}
              disabled={isTogglingStacker || config.stacker_coefficients == null}
              onClick={() => handleToggleStacker(!config.stacker_enabled)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                config.stacker_enabled ? "bg-emerald-500" : "bg-muted",
                (isTogglingStacker || config.stacker_coefficients == null) && "opacity-50 cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 transform rounded-full bg-white transition-transform",
                  config.stacker_enabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </label>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Substitui o blend por inverse-variance: aprende pesos pra Nota.Calc e Nota.Pr via Ridge
          segundo-nível em out-of-fold predictions contra `manual_score`. Lida com correlação de
          erros que inverse-variance assume não existir.
        </p>
        {config.stacker_coefficients ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">Fórmula aprendida</p>
              <p className="font-mono text-xs leading-relaxed">
                Final = {config.stacker_coefficients.intercept.toFixed(3)}
                {" + "}
                <span className="text-foreground">
                  {config.stacker_coefficients.calcWeight.toFixed(3)}
                </span>
                {" × Calc + "}
                <span className="text-foreground">
                  {config.stacker_coefficients.ridgeWeight.toFixed(3)}
                </span>
                {" × Pr"}
                {config.stacker_coefficients.knnWeight != null && (
                  <>
                    {" + "}
                    <span className="text-foreground">
                      {config.stacker_coefficients.knnWeight.toFixed(3)}
                    </span>
                    {" × kNN"}
                  </>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Pesos negativos indicam que o previsor está sendo penalizado (correlação com erro
                do outro). Pesos ~0 = previsor irrelevante.
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">MAE LOOCV do stacker</p>
              <p className="mt-1 font-mono text-base">
                {config.stacker_coefficients.cvMAE.toFixed(4)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Treino: {config.stacker_coefficients.trainSize} obras (leave-one-out).
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Treino insuficiente (mínimo 30 obras com nota pessoal e Ridge real, não stub).
          </p>
        )}
      </div>

      {/* Distribuição de prediction_distance */}
      {snapshot.worksWithDistance > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">
            Distância ao centróide do treino (Nota.Pr)
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Distância Euclidiana nas features padronizadas.{" "}
            {config.distance_p95 != null ? (
              <>
                Threshold de outlier (P95 do treino):{" "}
                <span className="font-mono text-foreground">{config.distance_p95.toFixed(2)}</span>.
                Obras acima disso têm Nota.Pr com peso reduzido em Nota.Final.{" "}
              </>
            ) : (
              "Threshold ainda não calibrado (rode 'Recalibrar agora'). "
            )}
            {snapshot.worksWithDistance} obras com dado.
          </p>
          <div className="space-y-1">
            {snapshot.distanceBuckets.map((bucket) => {
              const pct = snapshot.worksWithDistance > 0
                ? (bucket.count / snapshot.worksWithDistance) * 100
                : 0
              return (
                <div key={bucket.label} className="flex items-center gap-2 text-xs">
                  <span className="w-14 font-mono text-muted-foreground">{bucket.label}</span>
                  <div className="flex-1 rounded-sm bg-muted/40 overflow-hidden">
                    <div
                      className="h-3 bg-primary/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono">
                    {bucket.count} ({pct.toFixed(0)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
