"use client"

import dynamic from "next/dynamic"

export const MaeHistoryChart = dynamic(
  () => import("./mae-history-chart-inner").then((m) => m.MaeHistoryChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] w-full items-center justify-center text-xs text-muted-foreground">
        Carregando gráfico…
      </div>
    ),
  }
)
