import { Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { TasteProfileCard } from "@/components/recommendations/taste-profile-card"
import { RunCreatorForm } from "@/components/recommendations/run-creator-form"
import { RunHistoryList } from "@/components/recommendations/run-history-list"
import {
  getTasteProfileStatusAction,
} from "@/server/actions/recommendations"
import { listRecommendationRuns } from "@/server/queries/recommendations"

export const revalidate = 60

export default async function RecommendationsPage() {
  const [status, runs] = await Promise.all([
    getTasteProfileStatusAction(),
    listRecommendationRuns(50),
  ])

  const insufficient = status.ratedWorksCount < 5
  const stubBlocks = status.profile?.is_stub ?? false
  const disabled = insufficient || stubBlocks
  const disabledReason = insufficient
    ? "Avalie pelo menos 5 obras com manual_score pra desbloquear o ranking."
    : stubBlocks
      ? "Perfil ainda em modo stub — avalie mais obras pra desbloquear o ranking."
      : null

  return (
    <div className="w-full space-y-4">
      <Header
        kicker="IA"
        title="Recomendações"
        description="Perfil de gosto + ranking dos favoritos. Cada execução fica salva no histórico."
        icon={<Sparkles />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TasteProfileCard status={status} />
        <RunCreatorForm disabled={disabled} disabledReason={disabledReason} />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico de execuções
          </h2>
          <span className="text-xs text-muted-foreground">{runs.length} salva(s)</span>
        </div>
        <RunHistoryList runs={runs} />
      </section>
    </div>
  )
}
