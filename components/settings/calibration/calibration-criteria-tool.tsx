import { AttributeBiasTable } from "@/components/settings/calibration/attribute-bias-table"
import { RegenerateCalibratedArtifactsButton } from "@/components/settings/calibration/regenerate-calibrated-artifacts-button"
import { PredictionHealthCard } from "@/components/settings/calibration/prediction-health-card"
import { TasteModelHealthPanel } from "@/components/settings/calibration/taste-model-health-panel"
import { ModelErrorBandsPanel } from "@/components/settings/calibration/model-error-bands-panel"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import { getTasteModelHealth, getOofBucketBreakdown } from "@/server/queries/taste-model-health"
import { getAttributeBiasOverview } from "@/server/queries/attribute-bias"

/**
 * Card "Viés & atributos" — só LEITURA, com uma escrita: regenerar artefatos calibrados.
 *
 * 🔴 O "Relatório de viés" saiu em 2026-08-17. Ele mandava estatísticas agregadas pro Sonnet
 * e gravava a prosa de volta em `calibration_runs.bias_report` — que era **gravada, exibida
 * e consumida por ninguém**: nenhum prompt, limiar ou pipeline lia aquilo. O último tinha 2
 * meses. E o que ele narrava já está medido e visível aqui sem chamada paga: o offset por
 * atributo (`attribute_bias`, ~110 obras por atributo, viés real entre −0,19 e +0,06), a
 * saúde da Nota Prevista e as faixas onde ela erra mais.
 *
 * ⚠️ Com ele foi a última aba — sobrou um conteúdo só, então as `Tabs` sumiram junto. Duas
 * abas para um painel só é moldura sem função, e a que abria por padrão era justamente a
 * inerte, deixando o offset (que muda TODA nota de origem IA) em segundo plano.
 */
export async function CalibrationBiasTool() {
  const [attributeBias, predictionHealth, tasteHealth, errorBands] = await Promise.all([
    getAttributeBiasOverview(),
    getPredictionHealth(),
    getTasteModelHealth(),
    getOofBucketBreakdown(),
  ])

  return (
    <div className="space-y-4">
      {tasteHealth && <TasteModelHealthPanel health={tasteHealth} />}

      <ModelErrorBandsPanel bands={errorBands} />

      <PredictionHealthCard health={predictionHealth} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Após coletar ou alterar avaliações pós-leitura, regenere os artefatos pra propagar o
          offset (TasteProfile + Ridge + alignment).
        </p>
        <RegenerateCalibratedArtifactsButton />
      </div>

      <AttributeBiasTable overview={attributeBias} />
    </div>
  )
}
