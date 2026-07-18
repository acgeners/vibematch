"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowDown, ArrowRight, ChevronDown, Info, Layers } from "lucide-react"
import { MaeHistoryChart } from "@/components/settings/calibration/mae-history-chart"
import { Button } from "@/components/ui/button"
import { AiPendingGuardDialog } from "@/components/settings/ai-pending-guard-dialog"
import type { AiPendingItem } from "@/components/settings/ai-pending-guard-dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ACCENT_BUTTON, type SettingsAccent } from "@/lib/settings-accent"
import { recalculateNow } from "@/server/actions/settings"
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
  const [lastRun, setLastRun] = useState<string | null>(null)
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
  // "Diagnósticos do pipeline (dev)" foi aposentado: as faixas de erro por MAE
  // (OOF) vivem em "Viés & atributos" (getOofBucketBreakdown) e a confiança do
  // público virou ação no filtro de Votos externos do ranking.

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
                <span>Quão certeira está a Nota Prevista</span>
                <InfoTooltip label={metricCopy.title} text={metricCopy.tooltip} />
              </p>
              <div className="flex items-baseline gap-2">
                <p className={cn("font-mono text-4xl font-semibold tabular-nums", maeColor(primaryMae))}>
                  {fmt(primaryMae, 2)}
                </p>
                <span className="text-xs text-muted-foreground">ponto de erro</span>
              </div>
              <p className="max-w-[44ch] text-[13px] text-foreground/80">
                As notas previstas erram, em média,{" "}
                <span className="font-medium text-foreground">
                  {primaryMae != null && primaryMae < 1
                    ? "menos de um ponto"
                    : `cerca de ${fmt(primaryMae, 1)} ponto`}
                </span>{" "}
                numa escala de 0 a 10.
              </p>
              <p className="text-[11px] text-muted-foreground">
                {primaryMetric.source === "prospective"
                  ? `${metricCopy.title} · ${primaryMetric.sampleSize ?? 0} previsões resolvidas`
                  : `Aprendido com ${snapshot.trainSize} de ${snapshot.totalWorks} obras que já têm sua nota pessoal.`}
              </p>
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
                Último recálculo: {relativeTime}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                Modelo <span className="font-mono">{config.formula_version}</span>
                <InfoTooltip
                  label="Versão da fórmula"
                  text="Versão da fórmula de cálculo. Muda quando você altera pesos, critérios ou o pipeline — serve pra saber qual receita gerou as notas atuais. (Interno: formula_config.formula_version.)"
                />
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

          {/* Medidor visual + comparação com o palpite ingênuo */}
          <div className="space-y-2">
            <MaeGauge primary={primaryMae} baseline={baselineMae} />
            {baselineMae != null && (
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
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
                      ? `↓ ${skillGainPct.toFixed(0)}% menos erro`
                      : `↑ ${Math.abs(skillGainPct).toFixed(0)}% mais erro`}
                  </span>
                )}
                <span>
                  que um <span className="font-medium text-foreground/80">palpite ingênuo</span> (sempre a
                  média das suas notas, <span className="font-mono">{fmt(baselineMae, 2)}</span>).
                </span>
                <InfoTooltip
                  label="Palpite ingênuo"
                  text="É o piso: se a Nota Prevista não ganhasse desse palpite com folga, ela quase não agregaria — e a alavanca passaria a ser ter mais obras com nota pessoal, não mexer no modelo. (Redução relativa de erro vs baseline — não é acurácia.)"
                />
              </p>
            )}
            {snapshot.expectedPredictorIsStub && (
              <span className="inline-block rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
                Modelo em fallback — precisa de ≥ 20 títulos com nota pessoal
              </span>
            )}
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
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              <span>Precisão ao longo do tempo</span>
              <InfoTooltip
                label="Histórico"
                text="O mesmo erro médio da headline, um ponto por dia (último recálculo de cada dia). A linha começa quando há medição fora da amostra (CV) gravada; snapshots anteriores não aparecem."
              />
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quanto mais baixa a linha, melhor — a mesma MAE honesta da headline, dia a dia.
            </p>
          </div>
          <MaeHistoryChart history={snapshot.history} />
        </div>

        {/* ============================================================ */}
        {/* COMO A NOTA PREVISTA É MONTADA (pipeline didático)           */}
        {/* ============================================================ */}
        <ScorePipeline />

        {/* ============================================================ */}
        {/* DE ONDE VEM A NOTA (feature importance do Ridge)            */}
        {/* ============================================================ */}
        {config.expected_ridge_coefficients && (
          <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
            <RidgeFeatureImportance
              ridge={config.expected_ridge_coefficients}
              label="De onde vem a nota"
            />
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
              O <span className="font-medium">ajuste de observação</span> que você define por obra é
              aplicado por fora deste modelo, como soma determinística (±0,30) sobre a Nota Prevista —
              por isso não aparece entre os pesos aprendidos acima.
            </p>
          </div>
        )}

        {/* Ponteiro: "Pesos automáticos" migrou pra Comportamento na criação */}
        <p className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground/80">
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            O ajuste <span className="font-medium text-muted-foreground">Pesos automáticos</span> agora
            fica em{" "}
            <Link
              href="/settings?g=avancado#card-on-create"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Comportamento na criação
            </Link>
            , junto dos outros gatilhos de custo de IA.
          </span>
        </p>
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

/**
 * Medidor visual do erro: onde a Nota Prevista cai numa régua 0 → "ruim", com o
 * palpite ingênuo (baseline) marcado como referência. Escala dinâmica pra caber
 * ambos com folga. Verde (bom) → âmbar → vermelho (ruim).
 */
function MaeGauge({ primary, baseline }: { primary: number | null; baseline: number | null }) {
  if (primary == null) return null
  const max = Math.max(baseline ?? 0, primary, 1) * 1.18
  const youPct = Math.min(100, (primary / max) * 100)
  const basePct = baseline != null ? Math.min(100, (baseline / max) * 100) : null
  return (
    <div className="pt-1">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 opacity-90">
        {basePct != null && (
          <div
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-muted-foreground"
            style={{ left: `${basePct}%` }}
          />
        )}
        <div
          className="absolute top-1/2 h-[18px] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-foreground"
          style={{ left: `${youPct}%`, boxShadow: "0 0 0 3px hsl(var(--card))" }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-0.5 rounded bg-foreground" />
          você <span className="font-mono">{fmt(primary, 2)}</span>
        </span>
        {baseline != null && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-0.5 rounded bg-muted-foreground" />
            palpite ingênuo <span className="font-mono">{fmt(baseline, 2)}</span>
          </span>
        )}
        <span className="ml-auto text-muted-foreground/60">← menor é melhor</span>
      </div>
    </div>
  )
}

// Pipeline didático da nota: nome claro na tela, nome interno no tooltip.
const PIPELINE_STEPS: Array<{ n: number; title: string; body: string; tip: string; final?: boolean }> = [
  {
    n: 1,
    title: "Notas da IA",
    body: "9 atributos viram uma nota de conteúdo.",
    tip: "A IA dá 9 notas por obra (romance, ação, humor…). Elas viram uma nota única, ponderada e amplificada. (Interno: agregado IA(n) — soma ponderada dos category_scores.)",
  },
  {
    n: 2,
    title: "Mistura com o público",
    body: "Pondera com a nota do público conforme os votos.",
    tip: "A nota da IA é ponderada com a média das plataformas. Quanto mais votos a obra tem, mais o público pesa. (Interno: Nota.Calc — pooling bayesiano de pseudo-votos + penalidades.)",
  },
  {
    n: 3,
    title: "Ajuste ao seu gosto",
    body: "Personaliza pela sua afinidade de tags e critérios.",
    tip: "Um modelo aprende, do seu histórico, como afinidade de tags e critérios mexem na sua nota — e ajusta o resultado. (Interno: regressão Ridge, expected_score, misturada com a Nota.Calc.)",
  },
  {
    n: 4,
    title: "Nota Prevista",
    body: "A nota que você provavelmente daria.",
    tip: "O resultado final mostrado no app — a nota que o sistema estima que você daria. (Interno: expected_score.)",
    final: true,
  },
]

/** Faixa de 4 passos que torna o cálculo da Nota Prevista legível de uma olhada. */
function ScorePipeline() {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Como a Nota Prevista é montada</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Do conteúdo avaliado até a nota final, em quatro passos. Cada passo tem um nome técnico —
          passe o mouse pra vê-lo.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-4">
        {PIPELINE_STEPS.map((s) => (
          <div key={s.n} className="pr-2">
            <span
              className={cn(
                "mb-2 inline-flex size-5 items-center justify-center rounded-md text-[11px] font-bold",
                s.final ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary",
              )}
            >
              {s.n}
            </span>
            <h4 className="flex items-center gap-0.5 text-[12.5px] font-semibold">
              <span>{s.title}</span>
              <InfoTooltip label={s.title} text={s.tip} />
            </h4>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        Seu <span className="font-medium text-foreground/80">ajuste de observação</span> por obra (±0,30)
        é somado por fora, depois do passo 4 — por isso não aparece entre os pesos aprendidos.
      </p>
    </div>
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
    label: "Conteúdo avaliado pela IA",
    tone: "primary",
    description:
      "As 9 notas por critério atribuídas pela IA (romance, ação, humor…) mais a nota combinada. É o quanto a previsão se apoia no conteúdo que a IA avaliou. (Internos: os 9 critérios + IA(n).)",
    belongs: (n) => (CRITERION_SLUGS as readonly string[]).includes(n) || n === "IA(n)",
  },
  {
    key: "platform",
    label: "Opinião do público",
    tone: "neutral",
    description:
      "A nota média das plataformas e o volume de votos. Quanto a previsão se apoia na opinião agregada do público. (Internos: Nota.M, LogVotos.)",
    belongs: (n) => n === "Nota.M" || n === "LogVotos",
  },
  {
    key: "personal",
    label: "Seu gosto pessoal",
    tone: "personal",
    description:
      "Afinidade de tags com obras que você amou/evitou e alinhamento de critérios. Quanto a previsão é personalizada pra você. As notas pós-leitura granulares só entram no plano Pago. (Internos: LovedTagOverlap, AvoidedTagOverlap, CriterionFitScore.)",
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
    label: "Contexto da obra",
    tone: "muted",
    description:
      "Metadados estruturais: capítulos, qualidade da sinopse, status de publicação, idade/duração e origem (manhwa/mangá/manhua). Sinal de contexto que não cai nos grupos acima. (Internos: Cps.N, SinopseScore, Status_*, ReleaseAge, RunLength, Origin_*.)",
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
  "IA(n)": "Nota da IA (combinada)",
  "Nota.M": "Média das plataformas",
  LogVotos: "Volume de votos",
  "Cps.N": "Capítulos",
  SinopseScore: "Qualidade da sinopse",
  LovedTagOverlap: "Tags que você amou",
  AvoidedTagOverlap: "Tags que você evita",
  CriterionFitScore: "Alinhamento de critérios",
  ReleaseAge: "Idade da obra",
  RunLength: "Duração",
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
  // Maior |peso|: escala das barras de magnitude na lista avançada.
  const maxAbs = Math.max(...coefficients.map((c) => Math.abs(c)), 1e-9)

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
          label="Peso de cada sinal"
          text="Quanto cada família de sinais pesa na previsão. Como os sinais são padronizados antes do ajuste, o tamanho do peso mede a importância relativa direta. (Interno: soma dos |coeficientes| do Ridge por grupo, normalizada.)"
        />
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        A Nota Prevista combina quatro famílias de sinais. As fatias abaixo mostram{" "}
        <span className="font-medium text-foreground">quanto cada uma influencia</span> o resultado.
        Passe o mouse em cada grupo pra ver o que ele inclui.
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
        {showLegend ? "Ocultar pesos" : "Ver todos os pesos, sinal a sinal (avançado)"}
      </button>

      {showLegend && (
        <div className="space-y-2 border-t border-border/40 pt-2">
          {/* Legenda logo abaixo do controle de expandir: ordem + sinal +/− */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="h-3 w-3" />
              do maior pro menor peso
            </span>
            <span className="flex gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-emerald-500">+</span> pra cima
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold text-rose-500">−</span> pra baixo
              </span>
            </span>
          </div>
          <ul className="columns-1 gap-x-6 text-[11px] sm:columns-2">
            {featureNames
              .map((name, i) => ({ name, coef: coefficients[i] ?? 0 }))
              .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
              .map(({ name, coef }) => {
                const pos = coef >= 0
                const barPct = Math.max(4, (Math.abs(coef) / maxAbs) * 100)
                return (
                  <li key={name} className="flex break-inside-avoid items-center gap-2 py-0.5">
                    <span
                      className={cn(
                        "w-12 shrink-0 text-right font-mono tabular-nums",
                        pos ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {pos ? "+" : "−"}
                      {Math.abs(coef).toFixed(3)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground/80">{featureLabel(name)}</span>
                    <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted/50">
                      <span
                        className={cn("block h-full rounded-full", pos ? "bg-emerald-500" : "bg-rose-500")}
                        style={{ width: `${barPct}%` }}
                      />
                    </span>
                  </li>
                )
              })}
          </ul>
        </div>
      )}
    </div>
  )
}
