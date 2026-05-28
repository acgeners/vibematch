"use client"

import dynamic from "next/dynamic"

export const CostByOperationChart = dynamic(
  () => import("./cost-by-operation-chart-inner").then((m) => m.CostByOperationChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Carregando gráfico…
      </div>
    ),
  }
)
