import { Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { CalibrationTriggerCards } from "@/components/settings/calibration/calibration-trigger-cards"
import { SuggestionsList } from "@/components/settings/calibration/suggestions-list"
import { BiasReportView } from "@/components/settings/calibration/bias-report-view"
import { RunHistoryTable } from "@/components/settings/calibration/run-history-table"
import { AttributeBiasTable } from "@/components/settings/calibration/attribute-bias-table"
import { RegenerateCalibratedArtifactsButton } from "@/components/settings/calibration/regenerate-calibrated-artifacts-button"
import { PredictionHealthCard } from "@/components/settings/calibration/prediction-health-card"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import {
  countPendingSuggestions,
  loadLastRun,
  loadRunHistory,
  loadSuggestions,
} from "@/server/queries/calibration"
import { getAttributeBiasOverview } from "@/server/queries/attribute-bias"
import { createAdminClient } from "@/lib/supabase/admin"

export const revalidate = 60

async function countRatedWorks(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .not("user_score", "is", null)
    .eq("is_archived", false)
  if (error) return 0
  return count ?? 0
}

export default async function CalibrationPage() {
  const [lastAudit, lastBias, ratedWorksCount, suggestions, pendingCount, runHistory, attributeBias, predictionHealth] = await Promise.all([
    loadLastRun("audit"),
    loadLastRun("bias"),
    countRatedWorks(),
    loadSuggestions({ limit: 300 }),
    countPendingSuggestions(),
    loadRunHistory(20),
    getAttributeBiasOverview(),
    getPredictionHealth(),
  ])

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Configurações"
        title="Calibração de critérios IA"
        description="Auditoria por obra (com auto-apply) e detecção de viés global nos category_scores."
        icon={<Sparkles />}
      />

      <CalibrationTriggerCards
        lastAudit={lastAudit}
        lastBias={lastBias}
        ratedWorksCount={ratedWorksCount}
      />

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">
            Pendentes ({pendingCount})
          </TabsTrigger>
          <TabsTrigger value="history">Histórico de sugestões</TabsTrigger>
          <TabsTrigger value="bias">Relatório de viés</TabsTrigger>
          <TabsTrigger value="attribute-bias">Calibração de atributos</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <SuggestionsList
            suggestions={suggestions.filter((s) => s.status === "pending")}
          />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <SuggestionsList
            suggestions={suggestions.filter((s) => s.status !== "pending")}
          />
        </TabsContent>
        <TabsContent value="bias" className="mt-4">
          {lastBias?.bias_report ? (
            <BiasReportView
              report={lastBias.bias_report}
              createdAt={lastBias.completed_at ?? lastBias.created_at}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum relatório gerado ainda. Use o botão acima.
            </p>
          )}
        </TabsContent>
        <TabsContent value="attribute-bias" className="mt-4 space-y-4">
          <PredictionHealthCard health={predictionHealth} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Após coletar ou alterar avaliações pós-leitura, regenere os artefatos pra propagar o
              offset (TasteProfile + Ridge + alignment).
            </p>
            <RegenerateCalibratedArtifactsButton />
          </div>
          <AttributeBiasTable overview={attributeBias} />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunHistoryTable runs={runHistory} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
