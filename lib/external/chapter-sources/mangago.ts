import { fetchMangagoChapters } from "@/lib/external/mangago"
import type { ChapterCheckInput, ChapterLookup } from "./types"

/**
 * Último capítulo no Mangago — **slug-only**.
 *
 * Só roda quando a obra tem um `external_id` do Mangago confirmado (`mangagoSlug`);
 * NÃO faz busca por título. Motivo: o Mangago é cf-gated e as calls são SERIALIZADAS
 * (mutex da sessão FlareSolverr nomeada, PR #100), então uma busca por título por obra
 * encareceria a checagem do lote inteiro. Pra habilitar numa obra que ainda não tem,
 * confirme a fonte Mangago na seleção de fontes — aí o slug fica salvo e vira match exato.
 *
 * Traz a lista real de capítulos (`chapterNumbers`) → contagem exata quando o Mangago é
 * a fonte vencedora (obra que não está no comix/coffeemanga).
 */
export async function getMangagoLatestChapter(
  input: ChapterCheckInput,
): Promise<ChapterLookup> {
  if (!input.mangagoSlug) return null

  const ch = await fetchMangagoChapters(input.mangagoSlug)
  if (!ch?.latest) return null

  return {
    chapter: ch.latest,
    source: "mangago",
    sourceUrl: `https://www.mangago.me/read-manga/${input.mangagoSlug}/`,
    releasedAt: ch.lastDateIso,
    cadenceDates: ch.recentDatesIso,
    chapterNumbers: ch.chapterNumbers,
  }
}
