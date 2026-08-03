"use client"

import { ChartNoAxesCombined, Sparkles } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RunHistoryList } from "@/components/recommendations/run-history-list"
import { RUN_MODE_LEGEND } from "@/components/recommendations/run-mode-display"
import { DeepDiveHistoryList } from "@/components/recommendations/deep-dive-history-list"
import type { RecommendationRunSummary } from "@/server/queries/recommendations"
import type { DeepDiveSummary } from "@/server/queries/deep-dive"

interface HistoryTabsProps {
  runs: RecommendationRunSummary[]
  dives: DeepDiveSummary[]
  /**
   * Há sessão? Só muda o texto do estado VAZIO — sem conta, "gere a primeira" é um convite
   * para algo que a pessoa não consegue fazer. Este estado passou a existir em 2026-08-03:
   * antes o deslogado não via vazio nenhum, via o histórico do DONO.
   */
  signedIn: boolean
}

/**
 * Histórico tabulado da página /recommendations:
 * - "Recomendações": rankings salvos (Modo rápido + chat) — comportamento de antes.
 * - "Deep Dives": todas as análises do Consultor IA num só lugar, sem abrir cada obra.
 */
export function HistoryTabs({ runs, dives, signedIn }: HistoryTabsProps) {
  return (
    <Tabs defaultValue="runs" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="runs">
          <ChartNoAxesCombined className="h-4 w-4" />
          Recomendações
          <span className="text-xs tabular-nums text-muted-foreground">{runs.length}</span>
        </TabsTrigger>
        <TabsTrigger value="dives">
          <Sparkles className="h-4 w-4" />
          Deep Dives
          <span className="text-xs tabular-nums text-muted-foreground">{dives.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="runs" className="mt-3 space-y-3">
        {runs.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {RUN_MODE_LEGEND.map(({ label, Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/25 px-2.5 py-1.5 text-xs text-muted-foreground select-none"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/85" />
                <span className="text-[11px] font-semibold leading-tight">{label}</span>
              </div>
            ))}
          </div>
        )}
        <RunHistoryList runs={runs} signedIn={signedIn} />
      </TabsContent>

      <TabsContent value="dives" className="mt-3">
        <DeepDiveHistoryList dives={dives} signedIn={signedIn} />
      </TabsContent>
    </Tabs>
  )
}
