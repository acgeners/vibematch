import { BookMarked } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ReadingTabs } from "@/components/reading/reading-tabs"
import { getReadingWorks } from "@/server/queries/reading"

export const dynamic = "force-dynamic"

export default async function ReadingPage() {
  const [reading, hiatus] = await Promise.all([
    getReadingWorks({ statuses: ["Reading"] }),
    getReadingWorks({ statuses: ["Hiatus"] }),
  ])

  return (
    <div className="space-y-4">
      <Header
        kicker="Biblioteca"
        title="Acompanhamento"
        description="Obras que você acompanha — em leitura e em hiatus. Verifique nas fontes externas se saíram capítulos novos (ou se uma obra parada voltou)."
        icon={<BookMarked />}
      />

      <ReadingTabs reading={reading} hiatus={hiatus} />
    </div>
  )
}
