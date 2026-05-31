"use client"

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
import type { CalibrationHistoryEntry } from "@/server/actions/settings"

interface HistoryChartDatum {
  ts: string
  date: string
  expected: number | null
  trainSize: number | null
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MaeHistoryChart({ history }: { history: CalibrationHistoryEntry[] }) {
  const lastPerDay = new Map<string, CalibrationHistoryEntry>()
  for (const h of history) {
    const k = dayKey(h.recorded_at)
    if (!lastPerDay.has(k)) lastPerDay.set(k, h)
  }

  if (lastPerDay.size < 2) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
        Histórico ainda não disponível — recalibre em pelo menos dois dias diferentes pra começar a
        acumular tendência. Cada dia mostra o estado mais recente do modelo.
      </div>
    )
  }

  const entries = Array.from(lastPerDay.values()).reverse()
  const minDay = new Date(dayKey(entries[0].recorded_at) + "T00:00:00")
  const maxDay = new Date(dayKey(entries[entries.length - 1].recorded_at) + "T00:00:00")
  const entriesByDay = new Map(entries.map((h) => [dayKey(h.recorded_at), h]))

  const data: HistoryChartDatum[] = []
  for (let d = new Date(minDay); d <= maxDay; d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const h = entriesByDay.get(k)
    data.push({
      ts: h?.recorded_at ?? d.toISOString(),
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      expected: h?.mae_expected ?? null,
      trainSize: h?.train_size ?? null,
    })
  }

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
            dataKey="expected"
            name="MAE Nota Prevista (in-sample)"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
