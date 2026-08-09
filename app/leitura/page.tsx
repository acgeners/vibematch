import { cookies } from "next/headers"
import { BookMarked } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ReadingList } from "@/components/reading/reading-list"
import { getReadingWorks } from "@/server/queries/reading"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import { READING_VIEW_COOKIE, normalizeReadingView } from "@/lib/reading-view-preference"

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

  // Vista inicial (lista × calendário) do cookie → o servidor já renderiza a vista final,
  // sem divergir da hidratação. `nowIso` ancora o mês/hoje do calendário nos dois lados.
  const defaultView = normalizeReadingView((await cookies()).get(READING_VIEW_COOKIE)?.value)
  const nowIso = new Date().toISOString()

  return (
    <div className="space-y-4">
      <Header
        title="Acompanhamento"
        description="Obras que você acompanha. Separadas entre publicação em andamento e concluídas/outras — verifique nas fontes externas se saíram capítulos novos (ou se uma parada voltou)."
        icon={<BookMarked />}
      />

      <ReadingList works={works} defaultView={defaultView} nowIso={nowIso} />
    </div>
  )
}
