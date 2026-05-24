import { Activity, AlertTriangle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { CostByOperationChart } from "@/components/settings/ai-usage/cost-by-operation-chart"
import { DailyCostChart } from "@/components/settings/ai-usage/daily-cost-chart"
import {
  getAiUsageByModel,
  getAiUsageByOperation,
  getAiUsageDailySeries,
  getAiUsageTotals,
  getRecentAiCalls,
} from "@/server/queries/ai-usage"
import type { UsageAggregate } from "@/server/queries/ai-usage"

export const dynamic = "force-dynamic"

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

export default async function AiUsagePage() {
  const [totals, byOperation, byModel, recent, dailySeries] = await Promise.all([
    getAiUsageTotals(),
    getAiUsageByOperation(30),
    getAiUsageByModel(30),
    getRecentAiCalls(50),
    getAiUsageDailySeries(30),
  ])

  const hasUnknownPricing = recent.some((r) => r.totalCostUsd === 0 && r.totalTokens > 0)

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Uso da API IA"
        description="Custo estimado e tokens consumidos por todas as chamadas Anthropic do app."
        icon={<Activity />}
      />

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

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Últimas 24h" agg={totals.last24h} />
        <KpiCard label="Últimos 7 dias" agg={totals.last7d} />
        <KpiCard label="Últimos 30 dias" agg={totals.last30d} />
        <KpiCard label="Total acumulado" agg={totals.allTime} />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
          <header className="border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-foreground">Custo diário (30d)</h2>
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
            <CostByOperationChart data={byOperation} />
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
              {byOperation.map((row) => (
                <tr key={row.operation} className="border-t border-border/40">
                  <td className="px-4 py-2 font-mono text-[11px]">{row.operation}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.nCalls}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLatency(row.avgLatencyMs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPct(row.errorRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
        <header className="border-b border-border/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">Por modelo (30 dias)</h2>
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
          <h2 className="text-sm font-semibold text-foreground">Últimas 50 chamadas</h2>
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
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                        ok
                      </span>
                    ) : (
                      <span
                        className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300"
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
