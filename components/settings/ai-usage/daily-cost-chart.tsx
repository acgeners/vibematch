"use client"

import dynamic from "next/dynamic"

export const DailyCostChart = dynamic(
  () => import("./daily-cost-chart-inner").then((m) => m.DailyCostChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
        Carregando gráfico…
      </div>
    ),
  }
)
