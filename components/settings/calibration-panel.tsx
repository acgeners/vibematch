"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { ChevronDown, Info, Layers } from "lucide-react"
import { MaeHistoryChart } from "@/components/settings/calibration/mae-history-chart"
import { Button } from "@/components/ui/button"
import { AiPendingGuardDialog } from "@/components/settings/ai-pending-guard-dialog"
import type { AiPendingItem } from "@/components/settings/ai-pending-guard-dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { recalculateNow, setScoreWeightsAuto } from "@/server/actions/settings"
import type { CalibrationHistoryEntry } from "@/server/actions/settings"
import { cn } from "@/lib/utils"
import type { FormulaConfig } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { POST_READING_WEIGHT_LABELS } from "@/lib/constants/post-reading-criteria"
import type { BucketBreakdown, CalibrationDiff } from "@/lib/calculations/calibration"
import {
  selectPrimaryModelMetric,
  describeMetricSource,
  calculateRelativeErrorReduction,
} from "@/lib/metrics/model-evaluation"
import type { ModelEvaluationMetrics } from "@/lib/metrics/model-evaluation"

interface CalibrationPanelProps {
  accent: SettingsAccent
  /** Pendências dos itens "Gerado por IA". Se houver, a recalibração pede confirmação. */
  aiPending?: AiPendingItem[]
  config: FormulaConfig
  /** Métricas de erro do modelo já normalizadas/validadas (F4). */
  metrics: ModelEvaluationMetrics
  snapshot: {
    totalWorks: number
    trainSize: number
    /** MAE de "chutar a média" das notas pessoais — piso que o modelo precisa bater. */
    baselineMae: number | null
    /** Fase 1 shadow mode: MAE in-sample do expected_score (L1 Ridge cleaned). */
    maeExpected: number | null
    pseudoVotesNotaM: number | null
    pseudoVotesBlend: number | null
    worstDiffs: CalibrationDiff[]
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

/** Cor pra MAE: verde ≤ 0.5, âmbar < 1.0, vermelho ≥ 1.0. */
function maeColor(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground"
  if (value <= 0.5) return "text-emerald-500"
  if (value < 1.0) return "text-amber-500"
  return "text-rose-500"
}

export function CalibrationPanel({ accent, aiPending, config, metrics, snapshot }: CalibrationPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [isTogglingAutoWeights, startAutoWeightsToggle] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showPendingGuard, setShowPendingGuard] = useState(false)

  // Trava: só entram itens gerados por IA que estão de fato pendentes.
  const pendingItems = (aiPending ?? []).filter((i) => i.count > 0)
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

  // Clique no botão: se há artefatos de IA pendentes, avisa antes; senão recalibra direto.
  const handleRecalibrateClick = () => {
    if (pendingItems.length > 0) setShowPendingGuard(true)
    else handleRecalibrate()
  }

  const handleRecalibrate = () => {
    startTransition(async () => {
      try {
        const result = await recalculateNow()
        const cal = result.calibration
        if (cal) {
          // Reporta a MESMA métrica HONESTA da headline: MAE CV da Nota Prevista
          // (nested-CV / held-out), NÃO o cvMAE interno otimista do RidgeCV.
          setLastRun(
            cal.expectedIsStub
              ? `${result.recalculated} obras recalculadas. ` +
                  `Treino: ${cal.expectedTrainSize ?? cal.trainSize} títulos — Nota Prevista em fallback (precisa de ≥ 20 títulos com nota pessoal).`
              : `${result.recalculated} obras recalculadas. ` +
                  `Treino: ${cal.expectedTrainSize ?? cal.trainSize} títulos · ` +
                  `MAE CV honesta (Nota Prevista) = ${fmt(cal.expectedHonestCvMAE, 2)}.`
          )
          toast.success(`Recalibrado. MAE CV honesta da Nota Prevista: ${fmt(cal.expectedHonestCvMAE, 2)}`)
        } else {
          toast.success(`${result.recalculated} obras recalculadas.`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao recalibrar")
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
            : "Pesos automáticos desativados — IA(n) usa pesos manuais de /preferencias.",
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

  // Métrica PRINCIPAL honesta (F4): prospectiva > CV/OOF > indisponível. Nunca
  // a in-sample. A prospectiva (prediction_ledger) ainda não é alimentada aqui
  // — vive na página técnica /admin/model-metrics; aqui a principal é a CV/OOF.
  const primaryMetric = selectPrimaryModelMetric(metrics)
  const metricCopy = describeMetricSource(primaryMetric.source)
  const primaryMae = primaryMetric.mae

  // Quanto o modelo reduz de erro vs o baseline trivial (chutar a média). Se a
  // redução for pequena/negativa, a Nota Prevista quase não agrega — sinal de
  // que a alavanca é mais dado rotulado, não mexer no modelo.
  const baselineMae = metrics.baselineMae
  const reduction =
    primaryMae != null && baselineMae != null
      ? calculateRelativeErrorReduction(primaryMae, baselineMae)
      : null
  const skillGainPct = reduction != null ? reduction * 100 : null

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
                <InfoTooltip label={metricCopy.title} text={metricCopy.tooltip} />
              </p>
              <div className="flex items-baseline gap-3">
                <p className={cn("font-mono text-3xl font-semibold tabular-nums", maeColor(primaryMae))}>
                  {fmt(primaryMae, 2)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {metricCopy.title}
                {primaryMetric.source === "prospective"
                  ? ` · ${primaryMetric.sampleSize ?? 0} previsões resolvidas`
                  : ` · Treino: ${snapshot.trainSize} / ${snapshot.totalWorks} obras`}
              </p>
              {baselineMae != null && (
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>
                    vs. baseline (chutar a média):{" "}
                    <span className="font-mono">{fmt(baselineMae, 2)}</span>
                  </span>
                  {skillGainPct != null && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium",
                        skillGainPct >= 15
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : skillGainPct >= 5
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-rose-500/15 text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {skillGainPct >= 0
                        ? `${skillGainPct.toFixed(0)}% menos erro que o baseline`
                        : `${Math.abs(skillGainPct).toFixed(0)}% mais erro que o baseline`}
                    </span>
                  )}
                  <InfoTooltip
                    label="Baseline trivial"
                    text="MAE de simplesmente prever a média das suas notas pra toda obra. É o piso: se a Nota Prevista não reduz o erro disso com folga, ela quase não agrega — e a alavanca passa a ser mais obras com nota pessoal, não mexer no modelo. (Redução de erro vs baseline — não é acurácia.)"
                  />
                </p>
              )}
            </div>

            {/* Ação */}
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button onClick={handleRecalibrateClick} disabled={isPending} className={ACCENT_BUTTON[accent]}>
                {isPending ? "Recalibrando..." : "Recalibrar agora"}
              </Button>
              {pendingItems.length > 0 && (
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  {pendingItems.length} item(ns) de IA pendente(s)
                </span>
              )}
              <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                Último: {relativeTime}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Versão: <span className="font-mono">{config.formula_version}</span>
              </span>
            </div>

            <AiPendingGuardDialog
              open={showPendingGuard}
              onOpenChange={setShowPendingGuard}
              items={pendingItems}
              onProceed={handleRecalibrate}
              description="A calibração usa esses artefatos como sinal (o kNN dos embeddings, entre outros). Recalibrar agora usa dados possivelmente desatualizados — a Nota Prevista pode sair pior. Resolva as pendências primeiro ou siga mesmo assim."
              proceedLabel="Recalibrar mesmo assim"
              proceedClassName={ACCENT_BUTTON[accent]}
            />
          </div>

          {/* Origem do sinal na Nota Prevista (o modelo do headline) */}
          {config.expected_ridge_coefficients && (
            <div className="space-y-1">
              <RidgeFeatureImportance
                ridge={config.expected_ridge_coefficients}
                label="Origem do sinal na Nota Prevista"
              />
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
                O <span className="font-medium">ajuste de observação</span> que você define por obra é
                aplicado por fora deste modelo, como soma determinística (±0,30) sobre a Nota Prevista —
                por isso não aparece entre os pesos aprendidos acima.
              </p>
            </div>
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
              {snapshot.expectedPredictorIsStub && (
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
                    text="Quando ativo, o IA(n) usa pesos inferidos do seu histórico (weight-inference por Ridge) — menos input manual em /preferencias. Quando desativa, usa os pesos que você configurou manualmente. Cai pra manual automaticamente se houver < 20 obras com nota pessoal."
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
              MAE CV da Nota Prevista por dia (último snapshot de cada dia) — o mesmo número honesto
              da headline ao longo do tempo. A linha começa quando há CV gravado; snapshots
              anteriores a essa mudança não aparecem.
            </p>
          </div>
          <MaeHistoryChart history={snapshot.history} />
        </div>

        {/* ============================================================ */}
        {/* DIAGNÓSTICO — onde o sistema acerta mais e menos             */}
        {/* ============================================================ */}
        <BucketDiagnostic overallMae={snapshot.maeExpected} buckets={snapshot.buckets} />

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
              {/* Pseudo-votos */}
              <div>
                <h4 className="mb-1 text-sm font-medium">Pseudo-votos (suavização Bayesiana)</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Votos fictícios somados pra estabilizar a média da plataforma quando há poucos dados.
                  É o que molda a feature <span className="font-mono">Nota.M</span> que entra na Nota
                  Prevista. Recalculado sozinho — não precisa monitorar com frequência.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MetricCard
                    label="Pseudo Nota.M (mediana × 2.0)"
                    tooltip="Quantos votos uma obra precisa pra a opinião da plataforma valer realmente. Ex.: 1620 → ~1620 votos pra a média global ter peso 50%. Mais alto = mais conservador com obras pouco populares. Molda a feature Nota.M do modelo."
                    live={snapshot.pseudoVotesNotaM}
                    stored={config.pseudo_votes_nota_m}
                    digits={0}
                    mismatch={hasMismatch(snapshot.pseudoVotesNotaM, config.pseudo_votes_nota_m, 0.10)}
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
                      <span>Clamp 0–10 no agregado IA (GPT)</span>
                      <InfoTooltip
                        label="Clamp GPT"
                        text="% de obras cujo agregado GPT estourou [0,10] antes do clamp. Esse agregado, amplificado, vira a feature IA(n) da Nota Prevista. ↓ menor = melhor. Alto (>20%) significa que a amplificação está empurrando obras pra fora da escala."
                      />
                    </p>
                    <p className="mt-1 font-mono text-base">
                      {config.gpt_clamp_hit_rate != null
                        ? `${(config.gpt_clamp_hit_rate * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
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

// Grupos semânticos pra agregar a importância das features da Nota Prevista.
// Como as features são padronizadas antes do fit, |coef| mede importância
// relativa direta. A "fatia" de cada grupo é a soma dos |coef| dividida pelo
// total — uma estimativa de onde o sinal da Nota Prevista vem.
const RIDGE_FEATURE_GROUPS: Array<{
  key: string
  label: string
  tone: "primary" | "muted" | "personal" | "neutral"
  description: string
  belongs: (name: string) => boolean
}> = [
  {
    key: "ia",
    label: "IA (9 atributos + agregado)",
    tone: "primary",
    description:
      "As 9 notas por critério atribuídas pela IA (romance, ação, humor…) mais o agregado não-linear IA(n). É o quanto a previsão se apoia no conteúdo avaliado pela IA.",
    belongs: (n) => (CRITERION_SLUGS as readonly string[]).includes(n) || n === "IA(n)",
  },
  {
    key: "platform",
    label: "Plataforma (Nota.M, votos)",
    tone: "neutral",
    description:
      "Sinal social externo: a nota média das plataformas (Nota.M) e o volume de votos (LogVotos). Quanto a previsão se apoia na opinião agregada do público.",
    belongs: (n) => n === "Nota.M" || n === "LogVotos",
  },
  {
    key: "personal",
    label: "Pessoal (afinidade de tags + critérios)",
    tone: "personal",
    description:
      "Seu gosto: sobreposição de tags com obras que você amou/evitou (LovedTagOverlap, AvoidedTagOverlap) e alinhamento de critérios (CriterionFitScore). Quanto a previsão é personalizada pra você. (As notas pós-leitura granulares só entram no modelo no plano Pago; em Free elas não contam aqui.)",
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
    label: "Outros (capítulos, sinopse, status, ano, origem)",
    tone: "muted",
    description:
      "Metadados estruturais: capítulos (Cps.N), qualidade da sinopse (SinopseScore), status de publicação, idade/duração da obra (ReleaseAge, RunLength) e origem (manhwa/mangá/manhua). Sinal de contexto que não cai nos grupos acima.",
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

// Rótulos amigáveis pros nomes crus de feature na lista "Ver pesos por feature".
// Os 9 critérios IA reusam CRITERIA_INFO e os post-scores reusam os labels
// pós-leitura; o restante é mapeado aqui.
const FEATURE_LABELS: Record<string, string> = {
  "IA(n)": "Agregado IA (não-linear)",
  "Nota.M": "Média das plataformas",
  LogVotos: "Volume de votos (log)",
  "Cps.N": "Capítulos (normalizado)",
  SinopseScore: "Qualidade da sinopse",
  LovedTagOverlap: "Afinidade c/ tags que você amou",
  AvoidedTagOverlap: "Sobreposição c/ tags que você evita",
  CriterionFitScore: "Alinhamento de critérios",
  ReleaseAge: "Idade da obra (anos)",
  RunLength: "Duração (anos)",
  ObsAdjustment: "Ajuste de observação",
  MeanPostScore: "Nota pós-leitura (média)",
}

const STATUS_FEATURE_LABELS: Record<string, string> = {
  Ongoing: "Em andamento",
  Completed: "Completo",
  Hiatus: "Hiato",
  Cancelled: "Cancelado",
  Unknown: "Desconhecido",
}

const ORIGIN_FEATURE_LABELS: Record<string, string> = {
  ko: "Coreano (manhwa)",
  ja: "Japonês (mangá)",
  zh: "Chinês (manhua)",
  other: "Outro",
  unknown: "Desconhecido",
}

/** Resolve o nome cru de uma feature do Ridge pra um rótulo legível. */
function featureLabel(name: string): string {
  const criterion = CRITERIA_INFO[name as keyof typeof CRITERIA_INFO]
  if (criterion) return criterion.name
  const post = POST_READING_WEIGHT_LABELS[name as keyof typeof POST_READING_WEIGHT_LABELS]
  if (post) return `Pós-leitura: ${post}`
  if (FEATURE_LABELS[name]) return FEATURE_LABELS[name]
  if (name.startsWith("Status_")) {
    const raw = name.slice("Status_".length)
    return `Status: ${STATUS_FEATURE_LABELS[raw] ?? raw}`
  }
  if (name.startsWith("Origin_")) {
    const raw = name.slice("Origin_".length)
    return `Origem: ${ORIGIN_FEATURE_LABELS[raw] ?? raw}`
  }
  return name
}

function RidgeFeatureImportance({
  ridge,
  label = "Origem do sinal na Nota Prevista",
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
      description: g.description,
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

      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        A Nota Prevista é prevista por um modelo (Ridge) que combina vários sinais. As fatias abaixo
        mostram <span className="font-medium text-foreground">de onde vem o peso</span> dessa previsão —
        quanto cada família de sinais contribui pro resultado. Passe o mouse em cada grupo pra ver o que
        ele inclui.
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

      {/* Lista compacta — % colado ao label (cor → % → nome) pra leitura direta */}
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 shrink-0 rounded-sm", toneClasses(r.tone))} />
            <span className="w-9 shrink-0 text-right font-mono font-semibold tabular-nums text-foreground">
              {r.pct.toFixed(0)}%
            </span>
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="truncate">{r.label}</span>
              <InfoTooltip label={r.label} text={r.description} />
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
              <li key={name} className="flex items-baseline gap-2">
                <span className="w-16 shrink-0 font-mono text-foreground">
                  {coef >= 0 ? "+" : ""}
                  {coef.toFixed(3)}
                </span>
                <span className="text-muted-foreground">{featureLabel(name)}</span>
                <span className="font-mono text-[11px] text-muted-foreground/50">{name}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

// Gate de effect-size pra sinalizar uma faixa como outlier:
//   - amostra mínima pra não cair em ruído (buckets pequenos são instáveis);
//   - erro >= overall + margem (effect-size absoluto, robusto à otimismo
//     in-sample uniforme do MAE por bucket).
const OUTLIER_MIN_N = 30
const OUTLIER_DELTA = 0.15

interface FlaggedBucket {
  group: string
  label: string
  mae: number
  count: number
  delta: number
}

function findOutliers(overallMae: number | null, buckets: BucketBreakdown): FlaggedBucket[] {
  if (overallMae == null) return []
  const scan = (group: string, list: BucketBreakdown["byDistance"]) =>
    list
      .filter(
        (b): b is { label: string; count: number; mae: number } =>
          b.mae != null && b.count >= OUTLIER_MIN_N && b.mae >= overallMae + OUTLIER_DELTA,
      )
      .map((b) => ({ group, label: b.label, mae: b.mae, count: b.count, delta: b.mae - overallMae }))
  return [
    ...scan("distância ao centróide", buckets.byDistance),
    ...scan("nº de votos", buckets.byVotes),
  ]
}

function BucketDiagnostic({
  overallMae,
  buckets,
}: {
  overallMae: number | null
  buckets: BucketBreakdown
}) {
  const outliers = findOutliers(overallMae, buckets)
  const uniform = outliers.length === 0

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div>
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          <span>Faixas fora do padrão</span>
          <InfoTooltip
            label="Faixas fora do padrão"
            text={`Procura faixas (por distância ao centróide ou nº de votos) onde o modelo erra notavelmente mais que a média — só sinaliza com ≥ ${OUTLIER_MIN_N} obras na faixa e MAE ≥ média + ${OUTLIER_DELTA.toFixed(2)}. Sem isso, a diferença é ruído amostral. MAE por faixa é in-sample (otimista) — serve só pra comparação relativa entre faixas, não como precisão absoluta.`}
          />
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Detecta perfis de obra onde a Nota Prevista é especialmente fraca e justificaria
          tratamento (ex.: peso menor por confiança). A precisão honesta global é a MAE CV da headline.
        </p>
      </div>

      {uniform ? (
        <p className="flex items-start gap-2 rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <span>✓</span>
          <span>
            Nenhuma faixa fora do padrão. O modelo erra de forma uniforme nas faixas com amostra
            suficiente — não há região que justifique tratamento especial. Pra baixar o erro global, a
            alavanca é mais obras com nota pessoal, não ajuste por faixa.
          </span>
        </p>
      ) : (
        <ul className="space-y-1">
          {outliers.map((o) => (
            <li
              key={`${o.group}-${o.label}`}
              className="flex items-center gap-2 rounded-md bg-amber-500/5 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400"
            >
              <span>⚠</span>
              <span>
                <span className="font-mono">{o.label}</span> ({o.group}) erra{" "}
                <span className="font-mono">+{o.delta.toFixed(2)}</span> acima da média — MAE{" "}
                <span className="font-mono">{o.mae.toFixed(2)}</span> em {o.count} obras.
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDown className="mr-1 inline h-3 w-3 transition-transform group-open:rotate-180" />
          Ver MAE por faixa (in-sample, aproximado)
        </summary>
        <div className="mt-3 space-y-3">
          <BucketBars title="Por distância ao centróide do treino" buckets={buckets.byDistance} />
          <BucketBars title="Por número de votos na plataforma" buckets={buckets.byVotes} />
        </div>
      </details>
    </div>
  )
}

function BucketBars({
  title,
  buckets,
}: {
  title: string
  buckets: BucketBreakdown["byDistance"]
}) {
  // Escala visual relativa ao pior bucket — sem selos de veredito (o gate de
  // outlier acima já cuida do "tem algo aqui?"); aqui são só os números crus.
  const maxMae = Math.max(...buckets.map((b) => b.mae ?? 0), 0.1)
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {buckets.map((bucket) => {
          const pct = bucket.mae != null ? (bucket.mae / maxMae) * 100 : 0
          return (
            <div key={bucket.label} className="flex items-center gap-2 px-1 text-xs">
              <span className="w-20 font-mono text-muted-foreground">{bucket.label}</span>
              <div className="flex-1 overflow-hidden rounded-sm bg-muted/40">
                <div
                  className={cn("h-3 transition-all", bucket.mae != null ? "bg-muted-foreground/40" : "bg-muted")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-24 text-right font-mono text-[11px]">
                MAE{" "}
                {bucket.mae != null ? (
                  bucket.mae.toFixed(2)
                ) : (
                  <span className="text-muted-foreground">sem amostra</span>
                )}{" "}
                <span className="text-muted-foreground">({bucket.count})</span>
              </span>
            </div>
          )
        })}
      </div>
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
        {note && <span className="ml-1 text-[11px] opacity-70">{note}</span>}
      </p>
      <p className="mt-1 font-mono text-base">{fmt(live, digits)}</p>
      {stored != null && (
        <p className="text-[11px] text-muted-foreground">
          Salvo: <span className="font-mono">{fmt(stored, digits)}</span>
          {mismatch && (
            <span className="ml-1 text-amber-500">• desatualizado</span>
          )}
        </p>
      )}
      {extra && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>
            {extra.label}: <span className="font-mono">{fmt(extra.value ?? null, extra.digits ?? 4)}</span>
          </span>
          {extra.tooltip && <InfoTooltip text={extra.tooltip} label={`${label} ${extra.label}`} />}
        </p>
      )}
    </div>
  )
}
