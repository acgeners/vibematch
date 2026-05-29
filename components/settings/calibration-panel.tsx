"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { ChevronDown, Info, Layers, TrendingDown, TrendingUp, Minus } from "lucide-react"
import { MaeHistoryChart } from "@/components/settings/calibration/mae-history-chart"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { recalculateNow, setStackerEnabled, setScoreWeightsAuto } from "@/server/actions/settings"
import type { CalibrationHistoryEntry } from "@/server/actions/settings"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { cn } from "@/lib/utils"
import type { FormulaConfig } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import type { BucketBreakdown, CalibrationDiff } from "@/lib/calculations/calibration"

interface CalibrationPanelProps {
  config: FormulaConfig
  snapshot: {
    totalWorks: number
    trainSize: number
    maeCalc: number | null
    maePredicted: number | null
    maeFinal: number | null
    /** Fase 1 shadow mode: MAE in-sample do expected_score (L1 Ridge cleaned). */
    maeExpected: number | null
    rmseCalc: number | null
    rmsePredicted: number | null
    rmseFinal: number | null
    pseudoVotesNotaM: number | null
    pseudoVotesBlend: number | null
    worstDiffs: CalibrationDiff[]
    predictorIsStub: boolean
    /** True quando todos os expected_score são null/stub — predictor L1 ainda não rodou ou treino < 20. */
    expectedPredictorIsStub: boolean
    /** Quantas obras têm expected_score preenchido (denominador do MAE expected). */
    expectedCoveredCount: number
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
  const [isTogglingAutoWeights, startAutoWeightsToggle] = useTransition()
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

  const handleToggleAutoWeights = (next: boolean) => {
    startAutoWeightsToggle(async () => {
      try {
        await setScoreWeightsAuto(next)
        toast.success(
          next
            ? "Pesos automáticos ativados — IA(n) usa pesos inferidos do seu histórico."
            : "Pesos automáticos desativados — IA(n) usa pesos manuais de /preferences.",
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao alternar pesos automáticos")
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

  // Precisão honesta da PREVISÃO (nota esperada / L1) — CV interno do RidgeCV.
  // É o número que importa pros 2 objetivos: prediz obras NÃO-LIDAS sem usar
  // sinal pós-leitura. O LOOCV da stacker (abaixo) é legado e otimista (usa
  // meanPostScore ≈ user_score → quase circular nas obras já lidas).
  const expectedCvMae =
    config.cv_mae_expected_stage1 != null && !snapshot.expectedPredictorIsStub
      ? Number(config.cv_mae_expected_stage1)
      : null

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
            {/* Precisão da PREVISÃO (nota esperada / L1) em destaque */}
            <div className="flex-1 space-y-1">
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>Precisão da previsão</span>
                <InfoTooltip
                  label="MAE CV da Nota Esperada"
                  text="Erro médio (cross-validation) da Nota Esperada (L1) — a previsão usada pra obras NÃO-LIDAS, sem usar sinal pós-leitura. É a precisão honesta pro objetivo de recomendar. ↓ Menor = mais preciso."
                />
              </p>
              <div className="flex items-baseline gap-3">
                <p className={cn("font-mono text-3xl font-semibold tabular-nums", maeColor(expectedCvMae))}>
                  {fmt(expectedCvMae, 2)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                MAE CV da Nota Esperada · Treino: {stacker?.trainSize ?? snapshot.trainSize} / {snapshot.totalWorks} obras
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Legado: stacker LOOCV{" "}
                <span className={cn("font-mono", maeColor(loocv))}>{fmt(loocv, 2)}</span>
                {loocvDelta != null && (
                  <span className="ml-1 align-middle">
                    <TrendBadge delta={loocvDelta} />
                  </span>
                )}{" "}
                <span className="italic">(otimista — usa sinal pós-leitura)</span>
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

          {/* Origem do sinal na Nota Esperada (o modelo do headline) */}
          {config.expected_ridge_coefficients && (
            <RidgeFeatureImportance
              ridge={config.expected_ridge_coefficients}
              label="Origem do sinal na Nota Esperada"
            />
          )}

          {/* Legado: fórmula da stacker (produz a Nota.Final, NÃO a Nota Esperada) */}
          {stacker ? (
            <details className="group rounded-md border border-border/50 bg-muted/10">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground/70 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                Legado — como a Nota.Final combina os previsores
              </summary>
              <div className="border-t border-border/40 px-3 pb-3 pt-2">
                <StackerFormula stacker={stacker} />
                {config.ridge_coefficients && (
                  <div className="mt-2">
                    <RidgeFeatureImportance ridge={config.ridge_coefficients} />
                  </div>
                )}
              </div>
            </details>
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
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-muted-foreground">
                  Pesos auto:{" "}
                  <span className="font-medium text-foreground">
                    {config.score_weights_auto ? "ativo" : "manual"}
                  </span>
                  <InfoTooltip
                    label="Pesos automáticos"
                    text="Quando ativo, o IA(n) usa pesos inferidos do seu histórico (weight-inference por Ridge) — menos input manual em /preferences. Quando desativa, usa os pesos que você configurou manualmente. Cai pra manual automaticamente se houver < 20 obras com nota pessoal."
                  />
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.score_weights_auto}
                  disabled={isTogglingAutoWeights}
                  onClick={() => handleToggleAutoWeights(!config.score_weights_auto)}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    config.score_weights_auto ? "bg-emerald-500" : "bg-muted",
                    isTogglingAutoWeights && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block size-4 transform rounded-full bg-white transition-transform",
                      config.score_weights_auto ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
              </label>

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
              MAE LOOCV do stacker (precisão honesta) e MAE Final in-sample (no treino) por dia
              (último snapshot de cada dia). Clique nas legendas pra ocultar/mostrar séries.
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

              {/* Shadow mode Fase 1: expected_score (L1 2-stage) */}
              <ShadowExpectedComparison
                maeExpected={snapshot.maeExpected}
                maeExpectedBaseline={config.mae_expected_baseline}
                maeFinal={snapshot.maeFinal}
                isStub={snapshot.expectedPredictorIsStub}
                coveredCount={snapshot.expectedCoveredCount}
                trainSize={snapshot.trainSize}
                stage2TrainSize={config.expected_stage2_train_size}
                expectedRidgeCoefficients={config.expected_ridge_coefficients}
              />

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
                      <span>Atributos negativos ativados</span>
                      <InfoTooltip
                        label="Atributos negativos"
                        text="% de obras em que drama/tragédia ultrapassaram o threshold e penalizaram. Se ficar 0%, o atributo virou decorativo."
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
                            <td className="px-3 py-2 text-right">{d.userScore.toFixed(1)}</td>
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
  // Termos cujo peso arredondado dá 0.00 são omitidos — o stacker aprendeu
  // que aquele previsor não está contribuindo. Intercept e Ridge ficam sempre
  // (são a espinha dorsal do modelo).
  const NEAR_ZERO = 0.005
  const allTerms: Array<{
    expr: string
    weight: number
    name: string
    description: string
    essential: boolean
  }> = [
    {
      expr: stacker.intercept.toFixed(2),
      weight: stacker.intercept,
      name: "Intercept",
      description:
        "Ajuste constante aprendido pelo Ridge segundo-nível. Compensa viés sistemático médio (ex.: se o sistema tende a prever 0.02 abaixo da sua nota, isso é absorvido aqui).",
      essential: true,
    },
    {
      expr: `(${stacker.calcWeight.toFixed(2)} × Nota Calc.)`,
      weight: stacker.calcWeight,
      name: "Nota Calc.",
      description:
        "Blend algorítmico de GPT + média da plataforma (Bayesiano). Não tem aprendizado nas suas notas — é a parte 'fria' do sistema. O peso indica o quanto de influência o stacker dá a essa estimativa.",
      essential: false,
    },
    {
      expr: `(${stacker.ridgeWeight.toFixed(2)} × Nota Prev.)`,
      weight: stacker.ridgeWeight,
      name: "Nota Prev. (Ridge)",
      description:
        "Preditor Ridge Regression treinado nas suas notas pessoais. Aprende padrões globais ('drama vale +X, romance vale +Y'). É o que mais carrega o sistema.",
      essential: true,
    },
  ]
  if (stacker.knnWeight != null) {
    allTerms.push({
      expr: `(${stacker.knnWeight.toFixed(2)} × kNN)`,
      weight: stacker.knnWeight,
      name: "kNN",
      description:
        "k-Nearest Neighbors sobre embeddings: pra prever a nota de uma obra, pega as obras mais parecidas que você já avaliou e tira uma média ponderada pela similaridade. Captura padrões locais que o Ridge perde.",
      essential: false,
    })
  }

  const terms = allTerms.filter((t) => t.essential || Math.abs(t.weight) >= NEAR_ZERO)
  const omitted = allTerms.filter((t) => !t.essential && Math.abs(t.weight) < NEAR_ZERO)

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

      {omitted.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Omitidos (peso ~0): {omitted.map((t) => t.name).join(", ")} — o stacker aprendeu que não estão contribuindo agora.
        </p>
      )}

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

// Grupos semânticos pra agregar a importância das features do Ridge (Nota.Pr).
// Como as features são padronizadas antes do fit, |coef| mede importância
// relativa direta. A "fatia" de cada grupo é a soma dos |coef| dividida pelo
// total — uma estimativa de onde o sinal do Nota.Pr vem.
const RIDGE_FEATURE_GROUPS: Array<{
  key: string
  label: string
  tone: "primary" | "muted" | "personal" | "neutral"
  belongs: (name: string) => boolean
}> = [
  {
    key: "ia",
    label: "IA (9 atributos + agregado)",
    tone: "primary",
    belongs: (n) => (CRITERION_SLUGS as readonly string[]).includes(n) || n === "IA(n)",
  },
  {
    key: "platform",
    label: "Plataforma (Nota.M, votos)",
    tone: "neutral",
    belongs: (n) => n === "Nota.M" || n === "LogVotos",
  },
  {
    key: "personal",
    label: "Pessoal (qualidade pós-leitura + tag overlap)",
    tone: "personal",
    belongs: (n) =>
      n === "MeanPostScore" ||
      n === "LovedTagOverlap" ||
      n === "AvoidedTagOverlap" ||
      n === "CriterionFitScore" ||
      // 8 post-reading scores granulares (Fase 1.5 single Ridge — antes
      // colapsados em MeanPostScore, agora cada um é feature própria).
      n.startsWith("post_"),
  },
  {
    key: "other",
    label: "Outros (capítulos, sinopse, status)",
    tone: "muted",
    belongs: () => true, // catch-all (último — não-IA, não-plataforma, não-pessoal)
  },
]

function toneClasses(tone: "primary" | "muted" | "personal" | "neutral"): string {
  switch (tone) {
    case "primary":
      return "bg-primary"
    case "personal":
      return "bg-emerald-500"
    case "neutral":
      return "bg-sky-500"
    case "muted":
      return "bg-muted-foreground/40"
  }
}

function RidgeFeatureImportance({
  ridge,
  label = "Origem do sinal no Nota.Pr",
}: {
  ridge: { featureNames: string[]; coefficients: number[] }
  label?: string
}) {
  const [showLegend, setShowLegend] = useState(false)
  const { featureNames, coefficients } = ridge

  // Soma |coef| por grupo. Catch-all "other" só conta features que ainda não
  // foram capturadas pelos grupos anteriores.
  const totals = new Map<string, number>()
  const claimed = new Set<string>()
  let grandTotal = 0
  for (const group of RIDGE_FEATURE_GROUPS) {
    let sum = 0
    for (let i = 0; i < featureNames.length; i++) {
      const name = featureNames[i]
      if (claimed.has(name)) continue
      if (group.key === "other" || group.belongs(name)) {
        sum += Math.abs(coefficients[i] ?? 0)
        claimed.add(name)
      }
    }
    totals.set(group.key, sum)
    grandTotal += sum
  }

  if (grandTotal === 0) return null

  const rows = RIDGE_FEATURE_GROUPS.map((g) => {
    const total = totals.get(g.key) ?? 0
    return {
      key: g.key,
      label: g.label,
      tone: g.tone,
      pct: (total / grandTotal) * 100,
    }
  })

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3" />
        <span>{label}</span>
        <InfoTooltip
          label="Feature importance"
          text="Soma dos |coeficientes| do Ridge por grupo de feature, normalizada. Como as features são padronizadas antes do fit, isso mede importância relativa direta. Não é exatamente 'variância explicada', mas é a aproximação prática mais comum."
        />
      </p>

      {/* Barra empilhada */}
      <div className="flex h-2 w-full overflow-hidden rounded-sm bg-muted/40">
        {rows.map((r) =>
          r.pct < 0.5 ? null : (
            <div
              key={r.key}
              className={toneClasses(r.tone)}
              style={{ width: `${r.pct}%` }}
              title={`${r.label}: ${r.pct.toFixed(1)}%`}
            />
          )
        )}
      </div>

      {/* Lista compacta */}
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 shrink-0 rounded-sm", toneClasses(r.tone))} />
            <span className="flex-1 text-muted-foreground">{r.label}</span>
            <span className="font-mono font-semibold text-foreground">
              {r.pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowLegend((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={showLegend}
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", showLegend && "rotate-180")}
        />
        {showLegend ? "Ocultar pesos individuais" : "Ver pesos por feature"}
      </button>

      {showLegend && (
        <ul className="space-y-0.5 border-t border-border/40 pt-2 text-[11px]">
          {featureNames
            .map((name, i) => ({ name, coef: coefficients[i] ?? 0 }))
            .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
            .map(({ name, coef }) => (
              <li key={name} className="flex items-center gap-2 font-mono">
                <span className="w-16 shrink-0 text-foreground">
                  {coef >= 0 ? "+" : ""}
                  {coef.toFixed(3)}
                </span>
                <span className="text-muted-foreground">{name}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Comparação shadow mode da Fase 1: `expected_score` (L1 2-stage) vs
 * Nota.Final atual. Critério de avanço pra Fase 2: ratio ≤ 1.05×.
 *
 * Mostra a decomposição 2-stage:
 *   - MAE Stage 1 (baseline puro, sem ajuste de qualidade)
 *   - MAE combined (baseline + Stage 2)
 *   - Diferença revela quanto Stage 2 (post-reading scores) está contribuindo
 *
 * Quando ainda não há dado de Stage 2 (migration 067 nova ou poucas obras com
 * post-scores), Stage 2 fica em null e só o baseline aparece.
 */
function ShadowExpectedComparison({
  maeExpected,
  maeExpectedBaseline,
  maeFinal,
  isStub,
  coveredCount,
  trainSize,
  stage2TrainSize,
  expectedRidgeCoefficients,
}: {
  maeExpected: number | null
  maeExpectedBaseline: number | null
  maeFinal: number | null
  isStub: boolean
  coveredCount: number
  trainSize: number
  stage2TrainSize: number | null
  expectedRidgeCoefficients: FormulaConfig["expected_ridge_coefficients"]
}) {
  const ratio =
    maeExpected != null && maeFinal != null && maeFinal > 0
      ? maeExpected / maeFinal
      : null
  const stage2Gain =
    maeExpectedBaseline != null && maeExpected != null
      ? maeExpectedBaseline - maeExpected
      : null

  return (
    <div>
      <h4 className="mb-1 flex items-center gap-2 text-sm font-medium">
        Shadow mode — L1 single Ridge (decomposto em baseline + qualidade)
        <InfoTooltip
          label="Decomposição"
          text="O novo expected_score é UM Ridge treinado conjuntamente em 22 features. A decomposição 'baseline + qualidade' é computada pós-hoc via atribuição linear (intercept + Σ coef×x agrupado): baseline = features de perfil, qualidade = 8 post-reading-scores granulares. Mesma precisão do legacy, com interpretação clara de cada axis."
        />
      </h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Diagnóstico in-sample. ⚠️ O ratio vs Nota.Final <strong>não é um gate válido</strong>: a
        Nota.Final usa <code className="font-mono">meanPostScore</code> (≈ user_score) → é quase
        circular nas obras lidas, então tem MAE artificialmente baixo. A precisão honesta da
        previsão é o <strong>MAE CV da Nota Esperada</strong> lá no topo.
      </p>

      {coveredCount === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          Nenhuma obra com <code className="font-mono">expected_score</code> ainda. Rode{" "}
          <strong>Recalcular agora</strong> após aplicar as migrations 066+067.
        </div>
      ) : isStub ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          Predictor L1 em modo stub — treino insuficiente (&lt; 20 obras com{" "}
          <code className="font-mono">user_score</code>).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <MetricCard
              label="MAE Stage 1 (baseline)"
              tooltip="MAE quando se usa SÓ o Stage 1 (perfil de gosto, sem ajuste de qualidade). Mostra quanto o modelo acerta só sabendo 'que tipo de obra é'."
              live={maeExpectedBaseline}
              stored={null}
              digits={2}
              mismatch={false}
              note="(perfil)"
            />
            <MetricCard
              label="MAE expected (combined)"
              tooltip="MAE quando se usa Stage 1 + Stage 2 (baseline + ajuste de qualidade). Reflete o que vai pra produção."
              live={maeExpected}
              stored={null}
              digits={2}
              mismatch={false}
              note={
                stage2TrainSize != null
                  ? `(Stage 2: ${stage2TrainSize} obras)`
                  : `(${coveredCount}/${trainSize})`
              }
            />
            <MetricCard
              label="MAE Nota.Final (legado)"
              tooltip="MAE in-sample do pipeline atual (Nota.IA + Nota.Pr + stacker). Baseline pra validar o L1."
              live={maeFinal}
              stored={null}
              digits={2}
              mismatch={false}
              note="(in-sample)"
            />
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                Ratio L1 / Final <span className="normal-case">(legado)</span>
                <InfoTooltip
                  label="Ratio (legado)"
                  text="MAE(expected in-sample) ÷ MAE(Nota.Final in-sample). NÃO é gate válido: a Nota.Final é circular (usa meanPostScore≈user_score), então seu MAE é artificialmente baixo. Um ratio >1 aqui é esperado e não indica regressão. Use o MAE CV da Nota Esperada (topo) pra precisão real."
                />
              </div>
              <div className="mt-1 text-lg font-mono font-semibold text-muted-foreground">
                {ratio != null ? `${ratio.toFixed(2)}×` : "—"}
              </div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">
                {ratio == null ? "Aguardando recálculo" : "comparação legada (não-gate)"}
              </div>
            </div>
          </div>

          {stage2Gain != null && stage2Gain > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <strong className="text-emerald-500">Stage 2 reduziu MAE em {stage2Gain.toFixed(2)}</strong>{" "}
              ({((stage2Gain / (maeExpectedBaseline ?? 1)) * 100).toFixed(0)}% de melhora vs baseline puro) —
              evidência de que os post-reading scores granulares carregam sinal real.
            </div>
          )}

          {expectedRidgeCoefficients && (
            <div className="mt-3">
              <RidgeFeatureImportance ridge={expectedRidgeCoefficients} />
            </div>
          )}
        </>
      )}
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
