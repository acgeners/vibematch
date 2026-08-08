"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { makeUsdScale } from "@/lib/format/money"

interface Props {
  data: Array<{ operation: string; label: string; totalCostUsd: number; nCalls: number }>
  active?: string | null
}

const COLORS = [
  "hsl(217 91% 60%)",
  "hsl(271 76% 65%)",
  "hsl(160 60% 50%)",
  "hsl(35 92% 60%)",
  "hsl(0 84% 65%)",
  "hsl(199 89% 55%)",
  "hsl(310 76% 65%)",
]

export function CostByOperationChart({ data, active }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filtered = data.filter((d) => d.totalCostUsd > 0).slice(0, 8)
  // As barras existem pra ser comparadas entre si, então a régua é a série toda —
  // uma unidade que trocasse no meio quebraria justamente essa leitura.
  const scale = makeUsdScale(...filtered.map((d) => d.totalCostUsd))
  if (filtered.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Sem chamadas com custo no período.
      </div>
    )
  }
  function goToOperation(operation: string | undefined) {
    if (!operation) return
    // Preserva o período (?range=) ao alternar o filtro de operação.
    const params = new URLSearchParams(searchParams.toString())
    if (operation === active) params.delete("op")
    else params.set("op", operation)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={filtered}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={scale.format}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            width={130}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, _name, item) => {
              const num = typeof value === "number" ? value : Number(value)
              const calls = (item?.payload as { nCalls?: number } | undefined)?.nCalls ?? 0
              return [`${scale.format(num)} · ${calls} chamadas`, "Custo"]
            }}
          />
          <Bar
            dataKey="totalCostUsd"
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(entry) => {
              const e = entry as { operation?: string; payload?: { operation?: string } }
              goToOperation(e?.operation ?? e?.payload?.operation)
            }}
          >
            {filtered.map((entry, i) => {
              const dim = active != null && entry.operation !== active
              return (
                <Cell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={dim ? 0.3 : 1}
                />
              )
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
