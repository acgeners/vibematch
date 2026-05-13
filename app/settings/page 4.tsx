import { createClient } from "@/lib/supabase/server"
import { Header } from "@/components/layout/header"
import { ScoreWeightsForm } from "@/components/settings/score-weights-form"
import { FormulaConfigForm } from "@/components/settings/formula-config-form"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { PostReadingWeightsForm } from "@/components/settings/post-reading-weights-form"
import { RankingPreferencesForm } from "@/components/settings/ranking-preferences-form"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

async function getSettingsData() {
  const supabase = await createClient()

  const [weightsRes, configRes, snapshot] = await Promise.all([
    supabase.from("score_weights").select("*").eq("is_active", true).order("display_order"),
    supabase.from("formula_config").select("*").limit(1).single(),
    getCalibrationSnapshot(),
  ])

  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)

  return {
    weights: weightsRes.data as ScoreWeight[],
    config: configRes.data as FormulaConfig,
    snapshot,
  }
}

export default async function SettingsPage() {
  const { weights, config, snapshot } = await getSettingsData()

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        title="Configurações"
        description="Ajuste os pesos dos critérios e parâmetros da fórmula"
      />

      <CollapsibleCard
        title="Preferências de ranking"
        description="Quantas obras exibir no ranking e notas mínimas para filtragem padrão."
        defaultOpen
      >
        <RankingPreferencesForm config={config} />
      </CollapsibleCard>

      <CollapsibleCard title="Pesos dos critérios" defaultOpen={false}>
        <ScoreWeightsForm weights={weights} />
      </CollapsibleCard>

      <CollapsibleCard title="Pesos dos critérios de avaliação" defaultOpen={false}>
        <PostReadingWeightsForm />
      </CollapsibleCard>

      <CollapsibleCard
        title="Calibração automática"
        description="MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado."
        defaultOpen={false}
      >
        <CalibrationPanel config={config} snapshot={snapshot} />
      </CollapsibleCard>

      <CollapsibleCard
        title="Sincronização de constantes"
        description="Regenera os arquivos locais de constantes a partir do Supabase."
        defaultOpen={false}
      >
        <SyncConstantsPanel />
      </CollapsibleCard>

      <CollapsibleCard
        title="Parâmetros da fórmula (avançado)"
        description="Edição manual: estes valores são sobrescritos a cada recálculo. Útil apenas para ajustes pontuais antes de uma reanálise."
        defaultOpen={false}
      >
        <FormulaConfigForm config={config} />
      </CollapsibleCard>
    </div>
  )
}
