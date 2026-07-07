import { fetchMangagoById } from "./mangago"

/**
 * E6 — Adapter default para `opts.fetchYear` do `resolveMangagoUrl`. Reusa o
 * detalhe já existente (`fetchMangagoById` → `MangagoDetail.year`). Mantido
 * separado da lógica pura para que o unit test do resolvedor NÃO carregue o
 * parser/scraper pesado — os testes principais injetam um `fetchYear` mockado.
 * PREPARADO, ainda NÃO integrado ao fluxo.
 */
export async function defaultFetchMangagoYear(slug: string): Promise<number | null> {
  const detail = await fetchMangagoById(slug)
  return detail?.year ?? null
}
