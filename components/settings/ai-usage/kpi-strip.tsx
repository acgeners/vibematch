import { cn } from "@/lib/utils"
import type { AiUsageKpis } from "@/server/queries/ai-usage"
import { formatLatency, formatPct, formatTokens } from "./format"
import { formatUsd } from "@/lib/format/money"

/** Sparkline SSR (sem cliente): polyline normalizada + ponto final destacado. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 68
  const h = 26
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => {
    const x = i * step
    const y = h - 2 - ((v - min) / span) * (h - 4)
    return [x, y] as const
  })
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const last = pts[pts.length - 1]!
  return (
    <svg
      className="absolute bottom-2.5 right-3 opacity-80"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={d} stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  )
}

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  /** valor relativo (fração) ou pontos, já com sinal; null = sem comparação. */
  delta: number | null
  deltaText: string
  /** true = subir é ruim (custo, latência, erro); neutral ignora valência. */
  higherIsWorse?: boolean
  neutral?: boolean
  spark?: number[]
  accent: string
}

function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaText,
  higherIsWorse,
  neutral,
  spark,
  accent,
}: KpiCardProps) {
  const flat = delta == null || Math.abs(delta) < 0.005
  const up = delta != null && delta > 0
  const tone = neutral || flat
    ? "muted"
    : (up ? higherIsWorse : !higherIsWorse)
      ? "bad"
      : "good"

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card/55 p-4 shadow-sm shadow-black/5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
        {delta != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-bold tabular-nums",
              tone === "bad" && "bg-rose-500/12 text-rose-600 dark:text-rose-400",
              tone === "good" && "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
              tone === "muted" && "bg-muted/60 text-muted-foreground",
            )}
          >
            {flat ? "±" : up ? "▲" : "▼"} {deltaText}
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
      {spark && <Sparkline values={spark} color={accent} />}
    </div>
  )
}

function pctText(v: number | null): string {
  if (v == null) return "—"
  return `${Math.abs(v * 100).toFixed(0)}%`
}

function ptsText(v: number | null): string {
  if (v == null) return "—"
  return `${Math.abs(v * 100).toFixed(1)}pt`
}

export function KpiStrip({ kpis, rangeLabel }: { kpis: AiUsageKpis; rangeLabel: string }) {
  const { current: cur, deltas } = kpis
  const failures = Math.round(cur.errorRate * cur.calls)
  const perCall = cur.calls > 0 ? cur.cost / cur.calls : 0
  const suffix = ` · ${rangeLabel}`

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        label={`Custo${suffix}`}
        value={formatUsd(cur.cost)}
        sub={cur.calls > 0 ? `${formatUsd(perCall)}/chamada` : undefined}
        delta={deltas?.costPct ?? null}
        deltaText={pctText(deltas?.costPct ?? null)}
        higherIsWorse
        spark={kpis.sparkline}
        accent="hsl(217 91% 60%)"
      />
      <KpiCard
        label={`Chamadas${suffix}`}
        value={cur.calls.toLocaleString("pt-BR")}
        sub={`${formatTokens(cur.tokens)} tokens`}
        delta={deltas?.callsPct ?? null}
        deltaText={pctText(deltas?.callsPct ?? null)}
        neutral
        accent="hsl(199 89% 55%)"
      />
      <KpiCard
        label={`Latência p95${suffix}`}
        value={formatLatency(cur.latencyP95)}
        sub={`p50 ${formatLatency(cur.latencyP50)}`}
        delta={deltas?.latencyP95Pct ?? null}
        deltaText={pctText(deltas?.latencyP95Pct ?? null)}
        higherIsWorse
        accent="hsl(35 92% 60%)"
      />
      <KpiCard
        label={`Taxa de erro${suffix}`}
        value={formatPct(cur.errorRate)}
        sub={`${failures} ${failures === 1 ? "falha" : "falhas"}`}
        delta={deltas?.errorRatePts ?? null}
        deltaText={ptsText(deltas?.errorRatePts ?? null)}
        higherIsWorse
        accent="hsl(160 60% 45%)"
      />
    </section>
  )
}
