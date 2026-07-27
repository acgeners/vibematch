import { Upload } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ImportModes } from "@/components/import/import-modes"
import { getPendingReviewWorks } from "@/server/actions/enrich"
import { getImportHistory, getImportStats } from "@/server/queries/imports"

export const dynamic = "force-dynamic"

export default async function ImportPage() {
  const [pendingReviewWorks, history, stats] = await Promise.all([
    getPendingReviewWorks(),
    getImportHistory(),
    getImportStats(),
  ])

  return (
    <div className="w-full max-w-5xl space-y-6">
      <Header
        kicker="Importação"
        icon={<Upload />}
        title="Importar obras"
        description="Traga sua lista do AniList, MyAnimeList, MangaUpdates ou Anime-Planet. As obras entram como pendentes; você revisa capa e sinopse, e as notas saem da Avaliação IA."
      />
      <ImportModes pendingReviewWorks={pendingReviewWorks} history={history} stats={stats} />
    </div>
  )
}
