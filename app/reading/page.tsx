import { cookies } from "next/headers"
import { BookMarked } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ReadingList } from "@/components/reading/reading-list"
import { getReadingWorks } from "@/server/queries/reading"
import { isCurrentUserAdmin } from "@/server/queries/current-user"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import {
  READING_COLLAPSED_BANDS_COOKIE,
  READING_VIEW_COOKIE,
  normalizeReadingView,
  parseCollapsedBands,
} from "@/lib/reading-view-preference"

export const dynamic = "force-dynamic"

export const metadata = { title: "Acompanhamento" }

export default async function ReadingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Lista ÚNICA: tudo que você acompanha (em leitura + em hiatus pessoal). A divisão
  // que importa na tela é por status de PUBLICAÇÃO (em andamento · concluídas · outras),
  // feita no cliente — por slug, pra estourar se um status sumir do Supabase em vez de
  // vir vazio em silêncio.
  const [works, canArchive] = await Promise.all([
    getReadingWorks({
      statuses: [
        personalStatusNameBySlugOrThrow("reading"),
        personalStatusNameBySlugOrThrow("hiatus"),
      ],
    }),
    // Arquivar tira a obra do catálogo de todos: só a curadoria vê o botão (o servidor já recusava).
    isCurrentUserAdmin(),
  ])

  // Vista inicial (lista × calendário) do cookie → o servidor já renderiza a vista final,
  // sem divergir da hidratação. `nowIso` ancora o mês/hoje do calendário nos dois lados.
  const cookieStore = await cookies()
  const defaultView = normalizeReadingView(cookieStore.get(READING_VIEW_COOKIE)?.value)
  const defaultCollapsedBands = parseCollapsedBands(cookieStore.get(READING_COLLAPSED_BANDS_COOKIE)?.value)
  const nowIso = new Date().toISOString()

  // Os filtros vivem na URL: é o que devolve o recorte ao voltar de uma obra. Vão como prop para o
  // servidor e a hidratação partirem do mesmo estado.
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value)
  }

  return (
    <div className="space-y-4">
      <Header
        title="Acompanhamento"
        description="Obras que você acompanha, separadas pela situação da publicação — verifique nas fontes externas se saíram capítulos novos (ou se uma parada voltou)."
        icon={<BookMarked />}
      />

      <ReadingList
        works={works}
        defaultView={defaultView}
        nowIso={nowIso}
        initialFilterQuery={query.toString()}
        defaultCollapsedBands={defaultCollapsedBands}
        canArchive={canArchive}
      />
    </div>
  )
}
