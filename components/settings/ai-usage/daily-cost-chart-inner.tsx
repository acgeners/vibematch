"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DailyUsagePoint } from "@/server/queries/ai-usage"
import { makeUsdScale } from "@/lib/format/money"

interface Props {
  data: DailyUsagePoint[]
}

function formatDayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function DailyCostChart({ data }: Props) {
  const hasData = data.some((d) => d.cost > 0 || d.calls > 0)
  // Régua do mês inteiro — eixo E tooltip. Tick a tick, um mês que cruza o corte
  // imprimiria "0¢ · 5¢ · 50¢ · $1,20" na mesma régua.
  const scale = makeUsdScale(...data.map((d) => d.cost))
  if (!hasData) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Sem dados nos últimos 30 dias.
      </div>
    )
  }
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={formatDayShort}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={scale.format}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const num = typeof value === "number" ? value : Number(value)
              if (name === "cost") return [scale.format(num), "Custo"]
              return [num, name as string]
            }}
            labelFormatter={(label) => formatDayShort(String(label))}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke="hsl(217 91% 60%)"
            strokeWidth={2}
            fill="url(#costGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
