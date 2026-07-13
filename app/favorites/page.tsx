import { Heart } from "lucide-react"
import { Header } from "@/components/layout/header"
import { FavoritesStatsHeader } from "@/components/favorites/favorites-stats-header"
import { GroupsIndex } from "@/components/favorites/lists/groups-index"
import { RecommendDialog } from "@/components/recommendations/recommend-dialog"
import { ViewRecommendationsButton } from "@/components/recommendations/view-recommendations-button"
import { canConsumeAi } from "@/server/queries/current-user"
import { getFavoritesSummary } from "@/server/queries/favorites"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getListsWithSummary, getWorksLiteForPicker } from "@/server/queries/lists"

// Índice de /favorites: grupos (recortes) + card fixo "Todos os favoritos".
// O detalhe (tabela/filtros clássicos) vive em /favorites/[listId].
export default async function FavoritesPage() {
  const [lists, summary, catalog, scoreThresholds, canAi] = await Promise.all([
    getListsWithSummary(),
    getFavoritesSummary(),
    getWorksLiteForPicker(),
    getScoreColorThresholds(),
    canConsumeAi(),
  ])
  const isPaid = canAi

  return (
    <div className="space-y-4">
      <Header
        kicker="Biblioteca"
        title="Favoritos"
        description="Organize suas obras em grupos pra comparar em contextos diferentes."
        icon={<Heart />}
      />

      <FavoritesStatsHeader
        summary={summary}
        scoreThresholds={scoreThresholds?.expected ?? null}
        actions={
          <>
            <RecommendDialog context="favorites" isPaid={isPaid} />
            <ViewRecommendationsButton />
          </>
        }
      />

      <GroupsIndex lists={lists} allSummary={summary} catalog={catalog} />
    </div>
  )
}
