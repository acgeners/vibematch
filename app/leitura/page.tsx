import { BookMarked } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ReadingList } from "@/components/reading/reading-list"
import { getReadingWorks } from "@/server/queries/reading"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"

export const dynamic = "force-dynamic"

export default async function ReadingPage() {
  // Lista ÚNICA: tudo que você acompanha (em leitura + em hiatus pessoal). A divisão
  // que importa na tela é por status de PUBLICAÇÃO (em andamento × concluída/outras),
  // feita no cliente — por slug, pra estourar se um status sumir do Supabase em vez de
  // vir vazio em silêncio.
  const works = await getReadingWorks({
    statuses: [
      personalStatusNameBySlugOrThrow("reading"),
      personalStatusNameBySlugOrThrow("hiatus"),
    ],
  })

  return (
    <div className="space-y-4">
      <Header
        kicker="Biblioteca"
        title="Acompanhamento"
        description="Obras que você acompanha. Separadas entre publicação em andamento e concluídas/outras — verifique nas fontes externas se saíram capítulos novos (ou se uma parada voltou)."
        icon={<BookMarked />}
      />

      <ReadingList works={works} />
    </div>
  )
}
