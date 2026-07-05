import { Activity, AlertTriangle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { BalanceCard } from "@/components/settings/ai-usage/balance-card"
import { CallLog } from "@/components/settings/ai-usage/call-log"
import { CollapsibleSection } from "@/components/settings/ai-usage/collapsible-section"
import { CostByOperationChart } from "@/components/settings/ai-usage/cost-by-operation-chart"
import { DailyCostChart } from "@/components/settings/ai-usage/daily-cost-chart"
import { KpiStrip } from "@/components/settings/ai-usage/kpi-strip"
import { OperationFilter } from "@/components/settings/ai-usage/operation-filter"
import { OperationsGlossary } from "@/components/settings/ai-usage/operations-glossary"
import { OperationsTable } from "@/components/settings/ai-usage/operations-table"
import { PeriodFilter } from "@/components/settings/ai-usage/period-filter"
import { ModelPill } from "@/components/settings/ai-usage/pills"
import { formatPct, formatTokens, formatUsd } from "@/components/settings/ai-usage/format"
import {
  AI_USAGE_RANGES,
  getAiOperationDiagnostics,
  getAiUsageByModel,
  getAiUsageDailySeries,
  getAiUsageKpis,
  getAnthropicBalanceStatus,
  getCoverFixReport,
  getRecentAiCalls,
  resolveRange,
} from "@/server/queries/ai-usage"
import { getCacheEventMetrics } from "@/server/queries/ai-cache"
import type { CacheEventsResult } from "@/server/queries/ai-cache"
import type { CoverFixReport } from "@/server/queries/ai-usage"
import { AI_OPERATIONS } from "@/lib/ai-observability"
import type { OperationMetrics } from "@/lib/ai-observability"

export const revalidate = 60

function labelOf(op: string): string {
  return AI_OPERATIONS[op as keyof typeof AI_OPERATIONS]?.label ?? op
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ op?: string | string[]; range?: string | string[] }>
}) {
  const params = await searchParams
  const opRaw = Array.isArray(params.op) ? params.op[0] : params.op
  const op = opRaw && opRaw.trim() ? opRaw.trim() : null
  const rangeRaw = Array.isArray(params.range) ? params.range[0] : params.range
  const range = resolveRange(rangeRaw)
  const rangeDays = range.days

  // diagnostics é sempre completo (sem filtro de op): alimenta a tabela por
  // operação, o gráfico de distribuição e o menu do filtro. As demais métricas
  // são escopadas pela operação selecionada (se houver).
  const [kpis, byModel, recent, dailySeries, balance, diagnostics, coverFix, cacheEvents] =
    await Promise.all([
      getAiUsageKpis(rangeDays, op),
      getAiUsageByModel(rangeDays, op),
      getRecentAiCalls(200, op, rangeDays),
      getAiUsageDailySeries(range.chartDays, op),
      getAnthropicBalanceStatus(),
      getAiOperationDiagnostics(rangeDays),
      getCoverFixReport(),
      getCacheEventMetrics(rangeDays, op),
    ])

  const diagOps = op
    ? diagnostics.operations.filter((o) => o.operation === op)
    : diagnostics.operations

  const operationOptions = diagnostics.operations.map((o) => ({
    key: o.operation,
    label: labelOf(o.operation),
  }))
  const distribution = diagnostics.operations.map((o) => ({
    operation: o.operation,
    label: labelOf(o.operation),
    totalCostUsd: o.costUsd,
    nCalls: o.attempts,
  }))
  const opSuffix = op ? ` · ${op}` : ""
  const hasUnknownPricing = recent.some((r) => r.totalCostUsd === 0 && r.totalTokens > 0)

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Uso da API IA"
        description="Custo estimado, latência e confiabilidade de todas as chamadas Anthropic do app."
        icon={<Activity />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodFilter ranges={AI_USAGE_RANGES} active={range.key} />
            <OperationFilter operations={operationOptions} active={op} />
          </div>
        }
      />

      <BalanceCard status={balance} />

      {hasUnknownPricing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Algumas chamadas têm <code>cost_total_usd = 0</code> mesmo com tokens consumidos. A tabela
            de preços em <code>lib/ai/pricing.ts</code> ainda está com placeholders zerados — confirme
            os valores na pricing page oficial da Anthropic antes de confiar nos totais.
          </div>
        </div>
      )}

      {op && (
        <p className="text-xs text-muted-foreground">
          Métricas abaixo (exceto a distribuição por operação) filtradas por{" "}
          <code className="font-mono text-foreground">{op}</code>.
        </p>
      )}

      <KpiStrip kpis={kpis} rangeLabel={range.label} />

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Custo diário{opSuffix}</h2>
            <span className="text-[11px] text-muted-foreground">
              últimos {range.chartDays} {range.chartDays === 1 ? "dia" : "dias"}
            </span>
          </header>
          <div className="px-3 py-3 sm:px-4">
            <DailyCostChart data={dailySeries} />
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Distribuição por operação</h2>
            <span className="text-[11px] text-muted-foreground">{range.label} · clique filtra</span>
          </header>
          <div className="px-3 py-3 sm:px-4">
            <CostByOperationChart data={distribution} active={op} />
          </div>
        </div>
      </section>

      {/* ── Por operação (unificada: agregados + diagnóstico + cache) ────── */}
      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Por operação</h2>
          <span className="text-[11px] text-muted-foreground">
            {range.label} · clique numa linha p/ detalhar · cabeçalho ordena
          </span>
        </header>
        <OperationsTable operations={diagOps} cache={cacheEvents.byOperation} active={op} />
      </section>

      {/* ── Por modelo ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Por modelo{opSuffix}</h2>
          <span className="text-[11px] text-muted-foreground">{range.label}</span>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2 text-right">Chamadas</th>
                <th className="px-4 py-2 text-right">Input</th>
                <th className="px-4 py-2 text-right">Output</th>
                <th className="px-4 py-2 text-right">Cache R/W</th>
                <th className="px-4 py-2 text-right">Custo USD</th>
              </tr>
            </thead>
            <tbody>
              {byModel.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma chamada registrada no período.
                  </td>
                </tr>
              )}
              {byModel.map((row) => (
                <tr key={row.modelName} className="border-t border-border/40">
                  <td className="px-4 py-2">
                    <ModelPill model={row.modelName} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.nCalls}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatTokens(row.inputTokens)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {formatTokens(row.cacheReadTokens)} / {formatTokens(row.cacheCreationTokens)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Chamadas recentes (interativo: ordena/filtra/expande) ────────── */}
      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Chamadas recentes{opSuffix}</h2>
          <span className="text-[11px] text-muted-foreground">
            {recent.length} no período · clique p/ detalhar
          </span>
        </header>
        <CallLog calls={recent} />
      </section>

      {/* ── Referência / diagnósticos especializados (recolhidos) ────────── */}
      <CollapsibleSection
        title="Glossário de operações"
        subtitle="O que cada operação faz — nome, modelo padrão, workload e cache (do catálogo AI_OPERATIONS)."
      >
        <OperationsGlossary />
      </CollapsibleSection>

      <CollapsibleSection
        title="Confiabilidade — cache, dedup e retries"
        subtitle="Cache de resultado (ai_cache_events), deduplicação single-flight e retries. Janela: período selecionado."
      >
        <ReliabilityBody cache={cacheEvents} diagnostics={diagOps} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Efeito do fix das capas (antes/depois)"
        subtitle="Comparação antes/depois do prefetch base64 das capas na avaliação IA."
      >
        <CoverFixBody report={coverFix} />
      </CollapsibleSection>
    </div>
  )
}

// ── Confiabilidade (Plano 2) ──────────────────────────────────────────────────

const IMG_CAT = "provider_image_invalid_request"

function imageErrorRate(o: OperationMetrics | null): string {
  if (!o || o.attempts === 0) return "—"
  const imgErr = o.errorsByCategory[IMG_CAT] ?? 0
  return `${((imgErr / o.attempts) * 100).toFixed(1)}% (${imgErr}/${o.attempts})`
}

function ReliabilityKpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-lg tabular-nums text-foreground">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * Confiabilidade (Plano 2): cache REAL (ai_cache_events), deduplicação
 * (single-flight) e retries. Honesto: o que não é observável é declarado, não
 * exibido como zero.
 */
function ReliabilityBody({
  cache,
  diagnostics,
}: {
  cache: CacheEventsResult
  diagnostics: OperationMetrics[]
}) {
  const t = cache.totals
  // Tentativas visíveis = tentativas físicas acima de 1 por solicitação lógica
  // (loop estruturado + fallback de imagem). Retries de REDE do SDK não entram.
  const visibleRetries = diagnostics.reduce((acc, o) => {
    const logical = o.logicalRequests ?? o.logicalRequestsApprox
    return acc + Math.max(0, o.attempts - logical)
  }, 0)

  return (
    <div className="space-y-4">
      {/* Cache */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cache</h3>
        {cache.unavailable ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span className="font-semibold">Não mensurável com a instrumentação atual.</span> Nenhum
              evento em <code className="font-mono">ai_cache_events</code> — a migration 107 ainda não
              foi aplicada, ou nenhuma consulta de cache ocorreu na janela.
            </div>
          </div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReliabilityKpi label="Lookups" value={String(t.lookups)} />
              <ReliabilityKpi
                label="Hit rate"
                value={t.hitRate != null ? formatPct(t.hitRate) : "—"}
                hint={`${t.hits} hit · ${t.misses} miss`}
              />
              <ReliabilityKpi label="Bypass" value={String(t.bypasses)} />
              <ReliabilityKpi
                label="Chamadas evitadas"
                value={String(t.providerCallsAvoided)}
                hint="hits + dedup"
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Operação</th>
                    <th className="px-3 py-2 text-right">Lookups</th>
                    <th className="px-3 py-2 text-right">Hit rate</th>
                    <th className="px-3 py-2 text-right">L1 mem</th>
                    <th className="px-3 py-2 text-right">L2 db</th>
                    <th className="px-3 py-2 text-right">Miss</th>
                    <th className="px-3 py-2 text-right">Dedup</th>
                  </tr>
                </thead>
                <tbody>
                  {cache.byOperation.map((o) => (
                    <tr key={o.operation} className="border-t border-border/40">
                      <td className="px-3 py-2 font-mono text-[11px]">{o.operation}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.lookups}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {o.hitRate != null ? formatPct(o.hitRate) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.layerHits.memory}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.layerHits.persistent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.misses}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.dedupWaits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Deduplicação */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Deduplicação (single-flight)
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Solicitações idênticas concorrentes que aguardaram uma já em voo:{" "}
          <span className="font-mono text-foreground">{cache.unavailable ? "—" : t.dedupWaits}</span>{" "}
          (= chamadas pagas evitadas por dedup). Escopo: processo único — não cobre múltiplas
          instâncias.
        </p>
      </div>

      {/* Retries */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Retries</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Tentativas físicas visíveis acima de 1 por solicitação lógica (loop estruturado + fallback
          de imagem): <span className="font-mono text-foreground">{visibleRetries}</span>. Detalhe por
          operação em “Por operação” (expanda a linha → Tent./solic.).
        </p>
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          Retries internos do SDK (429/529/5xx/timeout/rede):{" "}
          <span className="font-semibold">não observáveis com a instrumentação atual</span> — cada
          solicitação ao wrapper gera 1 linha; o SDK não expõe as tentativas de rede separadamente.
        </p>
      </div>

      {/* Idempotência */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Idempotência
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Conflitos concorrentes evitados (single-flight):{" "}
          <span className="font-mono text-foreground">{cache.unavailable ? "—" : t.dedupWaits}</span>.
          Constraints de DB de idempotência: fora desta rodada (exigem auditoria de duplicatas antes).
        </p>
      </div>
    </div>
  )
}

function CoverFixBody({ report }: { report: CoverFixReport }) {
  const { before, after } = report.comparison
  const cutoff = new Date(report.cutoffIso).toLocaleString("pt-BR")

  return (
    <div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Corte = merge do prefetch base64 ({cutoff}). Erro de imagem ={" "}
        <code className="font-mono">{IMG_CAT}</code>.
      </p>
      {report.afterCount === 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Ainda <span className="font-semibold">não mensurável</span>: 0 avaliações registradas
            após o fix. O fix é mais recente que toda a base atual de chamadas. Acumule avaliações
            em uso real (ou rode o teste manual da capa) para comparar.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Antes — tentativas</p>
            <p className="mt-0.5 font-mono text-lg tabular-nums">{before?.attempts ?? 0}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Antes — erro imagem</p>
            <p className="mt-0.5 font-mono text-lg tabular-nums">{imageErrorRate(before)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Depois — tentativas</p>
            <p className="mt-0.5 font-mono text-lg tabular-nums">{after?.attempts ?? 0}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Depois — erro imagem</p>
            <p className="mt-0.5 font-mono text-lg tabular-nums">{imageErrorRate(after)}</p>
          </div>
        </div>
      )}
      {!report.comparison.hasSufficientSample && report.afterCount > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Amostra insuficiente em pelo menos um dos lados — diferença ainda inconclusiva.
        </p>
      )}
    </div>
  )
}
