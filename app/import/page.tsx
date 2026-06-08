import { Header } from "@/components/layout/header"
import { ImportModes } from "@/components/import/import-modes"
import { getPendingReviewWorks } from "@/server/actions/enrich"

export const dynamic = "force-dynamic"

export default async function ImportPage() {
  const pendingReviewWorks = await getPendingReviewWorks()

  return (
    <div className="max-w-3xl space-y-6">
      <Header
        kicker="Importação"
        title="Importar obras"
        description="Importe listas do MyAnimeList, MangaUpdates e Anime-Planet"
      />
      <ImportModes pendingReviewWorks={pendingReviewWorks} />
    </div>
  )
}
