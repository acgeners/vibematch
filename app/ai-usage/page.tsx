import { Activity, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { BalanceCard } from "@/components/settings/ai-usage/balance-card"
import { CostByOperationChart } from "@/components/settings/ai-usage/cost-by-operation-chart"
import { DailyCostChart } from "@/components/settings/ai-usage/daily-cost-chart"
import { OperationFilter } from "@/components/settings/ai-usage/operation-filter"
import {
  getAiOperationDiagnostics,
  getAiUsageByModel,
  getAiUsageByOperation,
  getAiUsageDailySeries,
  getAiUsageTotals,
  getAnthropicBalanceStatus,
  getCoverFixReport,
  getRecentAiCalls,
} from "@/server/queries/ai-usage"
import { getCacheEventMetrics } from "@/server/queries/ai-cache"
import type { CacheEventsResult } from "@/server/queries/ai-cache"
import type { CoverFixReport, UsageAggregate } from "@/server/queries/ai-usage"
import type { OperationMetrics } from "@/lib/ai-observability"

export const revalidate = 60

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00"
  if (value < 0.005) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toLocaleString("pt-BR")
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—"
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatRelative(iso: string): string {
  const dt = new Date(iso)
  const diffMs = Date.now() - dt.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s atrás`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}min atrás`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h atrás`
  const d = Math.floor(h / 24)
  return `${d}d atrás`
}

function formatRatio(v: number | null): string {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : "—"
}

/** Solicitações lógicas: exato se disponível, senão ~aproximado (attempt 0/null). */
function formatLogical(o: OperationMetrics): string {
  return o.logicalRequests != null ? String(o.logicalRequests) : `~${o.logicalRequestsApprox}`
}

/** Maior entrada de um mapa de contagens, no formato "chave (n)". */
function topEntry(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) return "—"
  const [key, n] = entries.sort((a, b) => b[1] - a[1])[0]!
  return `${key} (${n})`
}

/** byWorkload compacto: "recurring 12 · admin 3". */
function formatWorkload(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return "—"
  return entries.map(([k, n]) => `${k} ${n}`).join(" · ")
}

function KpiCard({ label, agg }: { label: string; agg: UsageAggregate }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/55 p-4 shadow-sm shadow-black/5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-foreground">{formatUsd(agg.totalCostUsd)}</p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span>{agg.nCalls} chamadas</span>
        <span>{formatTokens(agg.totalTokens)} tokens</span>
        <span>lat. médio {formatLatency(agg.avgLatencyMs)}</span>
        <span>erros {formatPct(agg.errorRate)}</span>
      </div>
    </div>
  )
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ op?: string | string[] }>
}) {
  const params = await searchParams
  const opRaw = Array.isArray(params.op) ? params.op[0] : params.op
  const op = opRaw && opRaw.trim() ? opRaw.trim() : null

  // byOperation é sempre completo: alimenta a tabela/gráfico de breakdown e o menu
  // do filtro. As demais métricas são escopadas pela operação selecionada (se houver).
  const [totals, byOperation, byModel, recent, dailySeries, balance, diagnostics, coverFix, cacheEvents] =
    await Promise.all([
      getAiUsageTotals(op),
      getAiUsageByOperation(30),
      getAiUsageByModel(30, op),
      getRecentAiCalls(50, op),
      getAiUsageDailySeries(30, op),
      getAnthropicBalanceStatus(),
      getAiOperationDiagnostics(30),
      getCoverFixReport(),
      getCacheEventMetrics(30, op),
    ])

  const diagOps = op
    ? diagnostics.operations.filter((o) => o.operation === op)
    : diagnostics.operations

  const operationNames = byOperation.map((row) => row.operation)
  const opSuffix = op ? ` · ${op}` : ""
  const hasUnknownPricing = recent.some((r) => r.totalCostUsd === 0 && r.totalTokens > 0)

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Uso da API IA"
        description="Custo estimado e tokens consumidos por todas as chamadas Anthropic do app."
        icon={<Activity />}
        actions={<OperationFilter operations={operationNames} active={op} />}
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

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Últimas 24h" agg={totals.last24h} />
        <KpiCard label="Últimos 7 dias" agg={totals.last7d} />
        <KpiCard label="Últimos 30 dias" agg={totals.last30d} />
        <KpiCard label="Total acumulado" agg={totals.allTime} />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
          <header className="border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Custo diário (30d){opSuffix}</h2>
          </header>
          <div className="px-3 py-3 sm:px-4">
            <DailyCostChart data={dailySeries} />
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
          <header className="border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Distribuição por operação (30d)</h2>
          </header>
          <div className="px-3 py-3 sm:px-4">
            <CostByOperationChart data={byOperation} active={op} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Por operação (30 dias)</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Operação</th>
                <th className="px-4 py-2 text-right">Chamadas</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">Custo USD</th>
                <th className="px-4 py-2 text-right">Lat. médio</th>
                <th className="px-4 py-2 text-right">Erros</th>
              </tr>
            </thead>
            <tbody>
              {byOperation.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma chamada registrada nos últimos 30 dias.
                  </td>
                </tr>
              )}
              {byOperation.map((row) => {
                const isActive = op === row.operation
                return (
                <tr
                  key={row.operation}
                  className={
                    isActive
                      ? "border-t border-border/40 bg-primary/10"
                      : "border-t border-border/40 hover:bg-muted/30"
                  }
                >
                  <td className="px-4 py-2 font-mono text-[11px]">
                    <Link
                      href={isActive ? "/ai-usage" : `/ai-usage?op=${encodeURIComponent(row.operation)}`}
                      className="text-primary underline-offset-2 hover:underline"
                      title={isActive ? "Remover filtro" : `Filtrar por ${row.operation}`}
                    >
                      {row.operation}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.nCalls}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLatency(row.avgLatencyMs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPct(row.errorRate)}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Diagnóstico por operação (Plano 1 — Fase B) ─────────────── */}
      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">
            Diagnóstico por operação (30 dias){opSuffix}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Distingue solicitação lógica × tentativa física. Cache de resultado:{" "}
            {diagnostics.cache.hits > 0 && diagnostics.cache.hitRate != null
              ? `${formatPct(diagnostics.cache.hitRate)} de hit (${diagnostics.cache.hits} hits / ${diagnostics.cache.misses} misses)`
              : `${diagnostics.cache.misses} miss(es) registrados — hits de cache não são logados (taxa de hit fica pro Plano 2)`}
            .
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Operação</th>
                <th className="px-4 py-2 text-right">Solic. lóg.</th>
                <th className="px-4 py-2 text-right">Tentativas</th>
                <th className="px-4 py-2 text-right">Tent./solic.</th>
                <th className="px-4 py-2 text-right">Custo/sucesso</th>
                <th className="px-4 py-2 text-right">Lat. p50</th>
                <th className="px-4 py-2 text-right">Lat. p95</th>
                <th className="px-4 py-2">Erro principal</th>
                <th className="px-4 py-2">Workload</th>
              </tr>
            </thead>
            <tbody>
              {diagOps.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma chamada registrada nos últimos 30 dias.
                  </td>
                </tr>
              )}
              {diagOps.map((o) => (
                <tr key={o.operation} className="border-t border-border/40">
                  <td className="px-4 py-2 font-mono text-[11px]">{o.operation}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLogical(o)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{o.attempts}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatRatio(o.attemptsPerLogicalRequest)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {o.costPerSuccess != null ? formatUsd(o.costPerSuccess) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLatency(o.latencyP50Ms)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLatency(o.latencyP95Ms)}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">
                    {o.failures > 0 ? topEntry(o.errorsByCategory) : "—"}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">
                    {formatWorkload(o.byWorkload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Confiabilidade: cache real, dedup, retries (Plano 2) ─────── */}
      <ReliabilitySection cache={cacheEvents} diagnostics={diagOps} />

      {/* ── Efeito do fix das capas (antes/depois) ───────────────────── */}
      <CoverFixSection report={coverFix} />

      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Por modelo (30 dias){opSuffix}</h2>
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
                    Nenhuma chamada registrada nos últimos 30 dias.
                  </td>
                </tr>
              )}
              {byModel.map((row) => (
                <tr key={row.modelName} className="border-t border-border/40">
                  <td className="px-4 py-2 font-mono text-[11px]">{row.modelName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.nCalls}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatTokens(row.inputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTokens(row.cacheReadTokens)} / {formatTokens(row.cacheCreationTokens)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Últimas 50 chamadas{opSuffix}</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Quando</th>
                <th className="px-4 py-2">Operação</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">Custo</th>
                <th className="px-4 py-2 text-right">Lat.</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma chamada registrada ainda.
                  </td>
                </tr>
              )}
              {recent.map((row) => (
                <tr key={row.id} className="border-t border-border/40">
                  <td
                    className="px-4 py-2 text-muted-foreground"
                    title={new Date(row.createdAt).toLocaleString("pt-BR")}
                  >
                    {formatRelative(row.createdAt)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{row.operation}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">{row.modelName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLatency(row.latencyMs)}</td>
                  <td className="px-4 py-2">
                    {row.status === "success" ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        ok
                      </span>
                    ) : (
                      <span
                        className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300"
                        title={row.errorMessage ?? undefined}
                      >
                        erro
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

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
function ReliabilitySection({
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
    <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
      <header className="border-b border-border/60 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">
          Confiabilidade — cache, dedup e retries (Plano 2)
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Cache de RESULTADO medido em <code className="font-mono">ai_cache_events</code> (hits aparecem
          aqui, nunca em <code className="font-mono">ai_api_calls</code>). Janela: 30 dias.
        </p>
      </header>

      <div className="space-y-4 px-4 py-3 sm:px-5">
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
            operação em “Diagnóstico por operação” (Tent./solic.).
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
    </section>
  )
}

function CoverFixSection({ report }: { report: CoverFixReport }) {
  const { before, after } = report.comparison
  const cutoff = new Date(report.cutoffIso).toLocaleString("pt-BR")

  return (
    <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
      <header className="border-b border-border/60 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">Efeito do fix das capas (antes/depois)</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Corte = merge do prefetch base64 ({cutoff}). Erro de imagem ={" "}
          <code className="font-mono">{IMG_CAT}</code>.
        </p>
      </header>
      <div className="px-4 py-3 sm:px-5">
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
    </section>
  )
}
