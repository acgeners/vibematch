import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { ScoreWeightsForm } from "@/components/settings/score-weights-form"
import { FormulaConfigForm } from "@/components/settings/formula-config-form"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { PostReadingWeightsForm } from "@/components/settings/post-reading-weights-form"
import { RankingPreferencesForm } from "@/components/settings/ranking-preferences-form"
import { AiEvalPreferencesForm } from "@/components/settings/ai-eval-preferences-form"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import { PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM } from "@/lib/ai-evaluation/service"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

async function getSettingsData() {
  const supabase = createAdminClient()

  const [weightsRes, configRes, snapshot] = await Promise.all([
    supabase.from("score_weights").select("*").eq("is_active", true).order("display_order"),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    getCalibrationSnapshot(),
  ])

  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)
  if (!configRes.data?.[0]) throw new Error("formula_config não encontrado")

  return {
    weights: weightsRes.data as ScoreWeight[],
    config: configRes.data?.[0] as FormulaConfig,
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
        title="Preferências de avaliação IA"
        description="Quanto tolerar versões antigas antes de marcar obras como desatualizadas no backlog de /ai-evaluation."
        defaultOpen={false}
      >
        <AiEvalPreferencesForm
          config={config}
          currentPromptVersion={PROMPT_VERSION}
          currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        />
      </CollapsibleCard>

      <CollapsibleCard
        title="Sincronização de constantes"
        description="Regenera os arquivos locais de constantes a partir do Supabase."
        defaultOpen={false}
      >
        <SyncConstantsPanel />
      </CollapsibleCard>

      <CollapsibleCard
        title="Parâmetros calibrados (read-only)"
        description="Snapshot dos valores atuais do formula_config. Sobrescritos a cada recálculo — exibidos pra debug."
        defaultOpen={false}
      >
        <FormulaConfigForm config={config} />
      </CollapsibleCard>
    </div>
  )
}
