"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { ChevronDown, Info, Layers, TrendingDown, TrendingUp, Minus } from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { recalculateNow, setStackerEnabled } from "@/server/actions/settings"
import type { CalibrationHistoryEntry } from "@/server/actions/settings"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { cn } from "@/lib/utils"
import type { FormulaConfig } from "@/types/domain"
import type { BucketBreakdown, CalibrationDiff } from "@/lib/calculations/calibration"

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
    buckets: BucketBreakdown
    history: CalibrationHistoryEntry[]
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

/** Cor pra MAE: verde ≤ 0.5, âmbar < 1.0, vermelho ≥ 1.0. */
function maeColor(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground"
  if (value <= 0.5) return "text-emerald-500"
  if (value < 1.0) return "text-amber-500"
  return "text-rose-500"
}

export function CalibrationPanel({ config, snapshot }: CalibrationPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [isTogglingStacker, startStackerToggle] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
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
          toast.success(`Recalibrado. MAE LOOCV: ${fmt(cal.stacker?.cvMAE ?? cal.maeFinal, 3)}`)
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

  const stacker = config.stacker_coefficients
  const loocv = stacker?.cvMAE ?? null

  // Tendência: comparar LOOCV atual com o snapshot anterior do histórico.
  // history[0] é o snapshot mais recente; history[1] é o anterior.
  const previousLoocv = snapshot.history[1]?.mae_loocv_stacker ?? null
  const loocvDelta = loocv != null && previousLoocv != null ? loocv - previousLoocv : null

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        {/* ============================================================ */}
        {/* KPI PRINCIPAL — o que importa pra avaliar saúde do sistema  */}
        {/* ============================================================ */}
        <div className="rounded-lg border border-border bg-card/50 p-4 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* MAE LOOCV em destaque */}
            <div className="flex-1 space-y-1">
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>Precisão do sistema</span>
                <InfoTooltip
                  label="MAE LOOCV"
                  text="MAE LOOCV (Leave-One-Out Cross-Validation) — pra cada obra com nota pessoal, o sistema retreina sem ela e prevê. Mostra o erro médio esperado em obras NOVAS (sem nota). ↓ Menor = mais preciso. É o número mais honesto pra avaliar previsões futuras."
                />
              </p>
              <div className="flex items-baseline gap-3">
                <p className={cn("font-mono text-3xl font-semibold tabular-nums", maeColor(loocv))}>
                  {fmt(loocv, 2)}
                </p>
                {loocvDelta != null && <TrendBadge delta={loocvDelta} />}
              </div>
              <p className="text-xs text-muted-foreground">
                MAE LOOCV do stacker · Treino: {stacker?.trainSize ?? snapshot.trainSize} / {snapshot.totalWorks} obras
              </p>
            </div>

            {/* Ação */}
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button onClick={handleRecalibrate} disabled={isPending}>
                {isPending ? "Recalibrando..." : "Recalibrar agora"}
              </Button>
              <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                Último: {relativeTime}
              </span>
              <span className="text-[10px] text-muted-foreground">
                Versão: <span className="font-mono">{config.formula_version}</span>
              </span>
            </div>
          </div>

          {/* Fórmula aprendida */}
          {stacker ? (
            <StackerFormula stacker={stacker} />
          ) : (
            <p className="text-xs text-amber-500">
              Stacker sem treino suficiente (mínimo 30 obras com nota pessoal). Usando inverse-variance.
            </p>
          )}

          {/* Toggle stacker + Pseudo Nota.M + alerta de stub */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Pseudo Nota.M:{" "}
                <span className="font-mono text-foreground">
                  {fmt(snapshot.pseudoVotesNotaM ?? config.pseudo_votes_nota_m, 0)}
                </span>
                <InfoTooltip
                  label="Pseudo Nota.M"
                  text="Quantos votos uma obra precisa pra a opinião da plataforma valer realmente. Ex.: 1600 → uma obra precisa de ~1600 votos pra a média global ter peso 50% contra sua nota."
                />
              </span>
              {snapshot.predictorIsStub && (
                <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-500">
                  Modelo em fallback (precisa de ≥ 20 títulos com nota pessoal)
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-muted-foreground">
                Stacker: <span className="font-medium text-foreground">{config.stacker_enabled ? "ativo" : "desativado"}</span>
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
        </div>

        {lastRun && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-500">
            {lastRun}
          </p>
        )}

        {/* ============================================================ */}
        {/* HISTÓRICO — MAE ao longo do tempo                            */}
        {/* ============================================================ */}
        <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Histórico de precisão</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              MAE LOOCV do stacker (precisão honesta) e MAE Final in-sample (no treino) ao longo
              dos recálculos. Clique nas legendas pra ocultar/mostrar séries.
            </p>
          </div>
          <MaeHistoryChart history={snapshot.history} />
        </div>

        {/* ============================================================ */}
        {/* DIAGNÓSTICO — onde o sistema acerta mais e menos             */}
        {/* ============================================================ */}
        <div className="rounded-lg border border-border bg-card/50 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Onde o sistema acerta mais e menos</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              MAE da Nota.Final por faixa, calculado sobre as {snapshot.trainSize} obras com nota pessoal.
              Buckets com MAE alto indicam onde o sistema vai errar mais ao prever obras futuras desse perfil
              (alta distância ou poucos votos = mais incerteza).
            </p>
          </div>

          <BucketSection
            title="Por distância ao centróide do treino"
            tooltip="Distância ao centróide mede o quão diferente uma obra é das que o modelo já viu. Obras com distância alta são 'exóticas' — o modelo extrapola mal pra elas."
            buckets={snapshot.buckets.byDistance}
          />

          <BucketSection
            title="Por número de votos na plataforma"
            tooltip="Obras com poucos votos têm Nota.M pouco confiável (média da plataforma instável). Se o MAE for muito pior em <100, o sistema está sofrendo com falta de dado externo."
            buckets={snapshot.buckets.byVotes}
          />
        </div>

        {/* ============================================================ */}
        {/* DETALHES TÉCNICOS (colapsável)                                */}
        {/* ============================================================ */}
        <div className="rounded-lg border border-border/60 bg-card/30">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showDetails}
          >
            <span>Detalhes técnicos</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", showDetails && "rotate-180")}
            />
          </button>

          {showDetails && (
            <div className="space-y-6 border-t border-border/60 px-4 py-4">
              {/* MAE in-sample */}
              <div>
                <h4 className="mb-1 text-sm font-medium">MAE in-sample (no treino)</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Erro médio calculado sobre as obras que o modelo já viu — tende a ser otimista.
                  Pra a métrica honesta, use o MAE LOOCV acima. ↓ Menor = melhor.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MetricCard
                    label="Nota.Calc"
                    tooltip="Erro do blend algorítmico (GPT + média da plataforma) sozinho. ↓ menor = melhor. Útil pra: medir o quanto a parte 'sem aprendizado' acerta."
                    live={snapshot.maeCalc}
                    stored={config.mae_calc}
                    digits={2}
                    mismatch={hasMismatch(snapshot.maeCalc, config.mae_calc)}
                    extra={
                      config.stacker_enabled
                        ? undefined
                        : {
                            label: "RMSE",
                            value: config.rmse_calc,
                            digits: 2,
                            tooltip:
                              "RMSE pune erros grandes mais que pequenos. Usado pra pesar Nota.Calc em Nota.Final via inverso da variância.",
                          }
                    }
                  />
                  <MetricCard
                    label="Nota.Pr"
                    tooltip="Erro do preditor Ridge (treinado nas suas notas) sozinho. ↓ menor = melhor. Útil pra: medir o quanto o modelo personalizado acerta."
                    live={snapshot.maePredicted}
                    stored={config.mae_predicted}
                    digits={2}
                    mismatch={hasMismatch(snapshot.maePredicted, config.mae_predicted)}
                    extra={
                      config.stacker_enabled
                        ? undefined
                        : {
                            label: "RMSE",
                            value: config.rmse_predicted,
                            digits: 2,
                            tooltip:
                              "RMSE usado pra pesar Nota.Pr em Nota.Final via inverso da variância.",
                          }
                    }
                  />
                  <MetricCard
                    label="NotaFinal"
                    tooltip="Erro da nota final exibida ao usuário sobre as obras já avaliadas. Pode estar otimista (overfit) — compare com MAE LOOCV pra ver o gap."
                    live={snapshot.maeFinal}
                    stored={null}
                    digits={2}
                    mismatch={false}
                    note="(in-sample)"
                  />
                </div>
              </div>

              {/* Pseudo-votos */}
              <div>
                <h4 className="mb-1 text-sm font-medium">Pseudo-votos (suavização Bayesiana)</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Quantos votos fictícios são adicionados pra estabilizar médias com poucos dados.
                  Recalculados sozinho. Não precisa monitorar com frequência.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MetricCard
                    label="Pseudo Nota.M (mediana × 2.0)"
                    tooltip="Diz quantos votos uma obra precisa pra a opinião da plataforma valer realmente. Ex.: 1600 → uma obra precisa de ~1600 votos pra a média global ter peso 50%. Mais alto = mais conservador com obras pouco populares."
                    live={snapshot.pseudoVotesNotaM}
                    stored={config.pseudo_votes_nota_m}
                    digits={0}
                    mismatch={hasMismatch(snapshot.pseudoVotesNotaM, config.pseudo_votes_nota_m, 0.10)}
                  />
                  <MetricCard
                    label="Pseudo blend (mediana × 1.2)"
                    tooltip="Mesma ideia, mas pra o blend interno do Nota.Calc (entre GPT e plataforma). Impacto pequeno quando stacker está ativo."
                    live={snapshot.pseudoVotesBlend}
                    stored={config.pseudo_votes_blend}
                    digits={0}
                    mismatch={hasMismatch(snapshot.pseudoVotesBlend, config.pseudo_votes_blend, 0.10)}
                  />
                </div>
              </div>

              {/* Diagnósticos */}
              <div>
                <h4 className="mb-1 text-sm font-medium">Diagnósticos do pipeline</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Sinais de saúde dos cálculos internos. Útil pra detectar regressões silenciosas.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-border p-3">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Clamp 0–10 em Nota.IA (GPT)</span>
                      <InfoTooltip
                        label="Clamp GPT"
                        text="% de obras cujo GPT.N estourou os limites antes do clamp. ↓ menor = melhor. Alto (>20%) significa que a amplificação está empurrando obras pra fora da escala."
                      />
                    </p>
                    <p className="mt-1 font-mono text-base">
                      {config.gpt_clamp_hit_rate != null
                        ? `${(config.gpt_clamp_hit_rate * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {config.gpt_clamp_hit_rate != null && config.gpt_clamp_hit_rate > 0.2
                        ? "Alto — bônus pode estar empurrando obras pra fora da escala"
                        : "Abaixo de 20% = saudável"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Critérios negativos ativados</span>
                      <InfoTooltip
                        label="Critérios negativos"
                        text="% de obras em que drama/tragédia ultrapassaram o threshold e penalizaram. Se ficar 0%, o critério virou decorativo."
                      />
                    </p>
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
                  </div>
                </div>
              </div>

              {/* Distribuição de distância */}
              {snapshot.worksWithDistance > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">Distribuição de distância ao centróide</h4>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {config.distance_p95 != null ? (
                      <>
                        Threshold de outlier (P95):{" "}
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-foreground">{config.distance_p95.toFixed(2)}</span>
                          <InfoTooltip
                            label="P95"
                            text="Percentil 95 das distâncias do treino. Obras acima recebem peso reduzido em Nota.Pr quando stacker está desligado (ignorado quando stacker está ativo)."
                          />
                        </span>
                        . {snapshot.worksWithDistance} obras com dado.
                      </>
                    ) : (
                      <>Threshold ainda não calibrado (rode &quot;Recalibrar agora&quot;). {snapshot.worksWithDistance} obras com dado.</>
                    )}
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

              {/* Top divergências */}
              {snapshot.worstDiffs.length > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">
                    Top {snapshot.worstDiffs.length} maiores divergências
                  </h4>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Obras onde NotaFinal mais discorda da sua nota. Útil pra investigar casos pontuais.
                  </p>
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
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

// ============================================================
// Componentes auxiliares
// ============================================================

function InfoTooltip({ text, label }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Info: ${label}` : "Mais informações"}
          className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  )
}

function TrendBadge({ delta }: { delta: number }) {
  // Diferença em MAE: < 0.005 considerado estável (ruído).
  if (Math.abs(delta) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Minus className="h-3 w-3" />
        estável
      </span>
    )
  }
  // Delta negativo = MAE caiu = melhorou.
  const improved = delta < 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        improved
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      )}
    >
      {improved ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {improved ? "↓" : "↑"} {Math.abs(delta).toFixed(2)}
    </span>
  )
}

interface StackerCoefficients {
  intercept: number
  calcWeight: number
  ridgeWeight: number
  knnWeight: number | null
}

function StackerFormula({ stacker }: { stacker: StackerCoefficients }) {
  const [showLegend, setShowLegend] = useState(false)
  const terms: Array<{
    expr: string
    weight: number
    name: string
    description: string
  }> = [
    {
      expr: stacker.intercept.toFixed(2),
      weight: stacker.intercept,
      name: "Intercept",
      description:
        "Ajuste constante aprendido pelo Ridge segundo-nível. Compensa viés sistemático médio (ex.: se o sistema tende a prever 0.02 abaixo da sua nota, isso é absorvido aqui).",
    },
    {
      expr: `(${stacker.calcWeight.toFixed(2)} × Nota Calc.)`,
      weight: stacker.calcWeight,
      name: "Nota Calc.",
      description:
        "Blend algorítmico de GPT + média da plataforma (Bayesiano). Não tem aprendizado nas suas notas — é a parte 'fria' do sistema. O peso indica o quanto de influência o stacker dá a essa estimativa.",
    },
    {
      expr: `(${stacker.ridgeWeight.toFixed(2)} × Nota Prev.)`,
      weight: stacker.ridgeWeight,
      name: "Nota Prev. (Ridge)",
      description:
        "Preditor Ridge Regression treinado nas suas notas pessoais. Aprende padrões globais ('drama vale +X, romance vale +Y'). É o que mais carrega o sistema.",
    },
  ]
  if (stacker.knnWeight != null) {
    terms.push({
      expr: `(${stacker.knnWeight.toFixed(2)} × kNN)`,
      weight: stacker.knnWeight,
      name: "kNN",
      description:
        "k-Nearest Neighbors sobre embeddings: pra prever a nota de uma obra, pega as obras mais parecidas que você já avaliou e tira uma média ponderada pela similaridade. Captura padrões locais que o Ridge perde. Peso ~0 = o stacker aprendeu que o kNN não está agregando além do Ridge.",
    })
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3" />
        <span>Como o sistema combina os previsores</span>
        <InfoTooltip
          label="Fórmula stacker"
          text="O stacker é um Ridge segundo-nível que aprende quanto peso dar a cada previsor. Estes pesos foram aprendidos contra suas notas reais."
        />
      </p>

      {/* Equação completa pra leitura rápida */}
      <p className="font-mono text-sm leading-relaxed">
        Final ={" "}
        {terms.map((t, i) => (
          <span key={t.name}>
            {i > 0 && " + "}
            <span className="font-semibold">{t.expr}</span>
          </span>
        ))}
      </p>

      {/* Toggle pra mostrar/ocultar a legenda termo a termo */}
      <button
        type="button"
        onClick={() => setShowLegend((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={showLegend}
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", showLegend && "rotate-180")}
        />
        {showLegend ? "Ocultar explicação dos termos" : "Explicar cada termo"}
      </button>

      {/* Legenda termo a termo (colapsável) */}
      {showLegend && (
        <ul className="space-y-1.5 border-t border-border/40 pt-2.5">
          {terms.map((t) => (
            <li key={t.name} className="flex items-start gap-2 text-xs">
              <span className="w-16 shrink-0 font-mono text-foreground">
                {t.weight >= 0 ? "+" : ""}
                {t.weight.toFixed(2)}
              </span>
              <span className="w-28 shrink-0 font-medium text-foreground">{t.name}</span>
              <span className="flex-1 text-muted-foreground">{t.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${day}/${month} ${hh}:${mm}`
}

interface HistoryChartDatum {
  ts: string
  date: string
  loocv: number | null
  inSample: number | null
  trainSize: number | null
}

function MaeHistoryChart({ history }: { history: CalibrationHistoryEntry[] }) {
  if (history.length < 2) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
        Histórico ainda não disponível — clique em &quot;Recalibrar agora&quot; algumas vezes pra
        começar a acumular tendência. Cada recálculo registra um snapshot.
      </div>
    )
  }
  // history vem do mais recente; invertemos pra plotar cronologicamente.
  const data: HistoryChartDatum[] = history
    .slice()
    .reverse()
    .map((h) => ({
      ts: h.recorded_at,
      date: formatHistoryDate(h.recorded_at),
      loocv: h.mae_loocv_stacker,
      inSample: h.mae_final,
      trainSize: h.train_size,
    }))

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            stroke="hsl(var(--border))"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            stroke="hsl(var(--border))"
            domain={[0, "auto"]}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "11px",
            }}
            labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
            formatter={(value, name) => {
              const v = typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—"
              return [v, String(name)]
            }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="line"
            wrapperStyle={{ fontSize: "11px" }}
          />
          <Line
            type="monotone"
            dataKey="loocv"
            name="MAE LOOCV (honesto)"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="inSample"
            name="MAE Final (in-sample)"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function BucketSection({
  title,
  tooltip,
  buckets,
}: {
  title: string
  tooltip: string
  buckets: BucketBreakdown["byDistance"]
}) {
  // Escala visual relativa ao pior bucket pra realçar diferenças.
  const maxMae = Math.max(
    ...buckets.map((b) => b.maeFinal ?? 0),
    0.1,
  )
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-xs font-medium">
        <span>{title}</span>
        <InfoTooltip label={title} text={tooltip} />
      </p>
      <div className="space-y-1">
        {buckets.map((bucket) => {
          const pct = bucket.maeFinal != null ? (bucket.maeFinal / maxMae) * 100 : 0
          const status = maeStatus(bucket.maeFinal)
          return (
            <div
              key={bucket.label}
              className={cn(
                "flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-xs",
                status.rowBg,
              )}
            >
              <span className="w-20 font-mono text-muted-foreground">{bucket.label}</span>
              <div className="flex-1 rounded-sm bg-muted/40 overflow-hidden">
                <div
                  className={cn("h-4 transition-all", status.barColor)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-24 text-right font-mono text-[11px]">
                MAE{" "}
                {bucket.maeFinal != null ? (
                  <span className={maeColor(bucket.maeFinal)}>{bucket.maeFinal.toFixed(2)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}{" "}
                <span className="text-muted-foreground">({bucket.count})</span>
              </span>
              <span
                className={cn(
                  "inline-flex w-20 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                  status.badgeClass,
                )}
              >
                {status.icon}
                {status.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface MaeStatus {
  label: string
  icon: string
  barColor: string
  rowBg: string
  badgeClass: string
}

function maeStatus(mae: number | null): MaeStatus {
  if (mae == null) {
    return {
      label: "sem amostra",
      icon: "—",
      barColor: "bg-muted",
      rowBg: "",
      badgeClass: "bg-muted/40 text-muted-foreground",
    }
  }
  if (mae <= 0.5) {
    return {
      label: "ótimo",
      icon: "✓",
      barColor: "bg-emerald-500/80",
      rowBg: "bg-emerald-500/5",
      badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    }
  }
  if (mae < 1.0) {
    return {
      label: "atenção",
      icon: "⚠",
      barColor: "bg-amber-500/80",
      rowBg: "bg-amber-500/5",
      badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    }
  }
  return {
    label: "ruim",
    icon: "✗",
    barColor: "bg-rose-500/80",
    rowBg: "bg-rose-500/5",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  }
}

interface MetricCardProps {
  label: string
  live: number | null
  stored: number | null
  mismatch: boolean
  digits?: number
  note?: string
  tooltip?: string
  extra?: {
    label: string
    value: number | null | undefined
    digits?: number
    tooltip?: string
  }
}

function MetricCard({ label, live, stored, mismatch, digits = 4, note, tooltip, extra }: MetricCardProps) {
  return (
    <div
      className={`rounded-md border p-3 ${
        mismatch ? "border-amber-500/40 bg-amber-500/5" : "border-border"
      }`}
    >
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        {tooltip && <InfoTooltip text={tooltip} label={label} />}
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
      {extra && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>
            {extra.label}: <span className="font-mono">{fmt(extra.value ?? null, extra.digits ?? 4)}</span>
          </span>
          {extra.tooltip && <InfoTooltip text={extra.tooltip} label={`${label} ${extra.label}`} />}
        </p>
      )}
    </div>
  )
}
