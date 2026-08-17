import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BiasTriggerZone } from "@/components/settings/calibration/calibration-trigger-cards"
import { BiasReportView } from "@/components/settings/calibration/bias-report-view"
import { AttributeBiasTable } from "@/components/settings/calibration/attribute-bias-table"
import { RegenerateCalibratedArtifactsButton } from "@/components/settings/calibration/regenerate-calibrated-artifacts-button"
import { PredictionHealthCard } from "@/components/settings/calibration/prediction-health-card"
import { TasteModelHealthPanel } from "@/components/settings/calibration/taste-model-health-panel"
import { ModelErrorBandsPanel } from "@/components/settings/calibration/model-error-bands-panel"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import { getTasteModelHealth, getOofBucketBreakdown } from "@/server/queries/taste-model-health"
import { loadLastRun } from "@/server/queries/calibration"
import { getAttributeBiasOverview } from "@/server/queries/attribute-bias"
import { createAdminClient } from "@/lib/supabase/admin"

async function countRatedWorks(): Promise<number> {
  const supabase = createAdminClient()
  // `works_owner`: "quantas obras VOCÊ notou" é a contagem de rótulos DO DONO (é o que calibra
  // o modelo dele). Vem do espelho via a view — `works.user_score` vai deixar de existir.
  const { count, error } = await supabase
    .from("works_owner")
    .select("id", { count: "exact", head: true })
    .not("user_score", "is", null)
    .eq("is_archived", false)
  if (error) return 0
  return count ?? 0
}

// Abas em estilo "linha" (sublinhado do item ativo) — legíveis como abas de
// verdade, ao contrário do segmentado apagado anterior. A barra ganha um trilho
// (`border-b`) e o item ativo, um sublinhado que encosta nele (`-mb-px`). O
// `after:hidden` mata o sublinhado embutido do variant pra não duplicar.
const TABS_LIST_CLASS =
  "h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0"
const TAB_TRIGGER_CLASS =
  "-mb-px flex-none rounded-none border-0 border-b-2 border-transparent px-3.5 pb-2.5 pt-1.5 text-sm font-medium after:hidden data-[state=active]:border-primary data-[state=active]:text-foreground"


/**
 * Card "Viés & atributos" — só LEITURA. Relatórios agregados que revelam
 * deslocamentos sistemáticos do catálogo e a saúde da Nota Prevista. Nenhum score
 * é alterado aqui (a única ação de escrita é regenerar artefatos calibrados).
 */
export async function CalibrationBiasTool() {
  const [lastBias, ratedWorksCount, attributeBias, predictionHealth, tasteHealth, errorBands] =
    await Promise.all([
      loadLastRun("bias"),
      countRatedWorks(),
      getAttributeBiasOverview(),
      getPredictionHealth(),
      getTasteModelHealth(),
      getOofBucketBreakdown(),
    ])

  return (
    <div className="space-y-4">
      <BiasTriggerZone lastBias={lastBias} ratedWorksCount={ratedWorksCount} />

      {tasteHealth && <TasteModelHealthPanel health={tasteHealth} />}

      <ModelErrorBandsPanel bands={errorBands} />

      <Tabs defaultValue="bias" className="w-full">
        <TabsList variant="line" className={TABS_LIST_CLASS}>
          <TabsTrigger value="bias" className={TAB_TRIGGER_CLASS}>
            Relatório de viés
          </TabsTrigger>
          <TabsTrigger value="attribute-bias" className={TAB_TRIGGER_CLASS}>
            Calibração de atributos
          </TabsTrigger>
        </TabsList>
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
      </Tabs>
    </div>
  )
}
