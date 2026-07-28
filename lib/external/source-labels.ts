/**
 * Nome de exibição das fontes externas, para a UI.
 *
 * ⚠️ Existe uma SEGUNDA cópia deste mapa em `lib/ai-evaluation/service.ts`
 * (`PLATFORM_DISPLAY_NAMES`) que NÃO deve ser unificada com esta: aquela entra no
 * texto do prompt, que entra no `inputHash` — trocá-la por este mapa (que tem
 * `mangago`/`outros` a mais) mudaria o hash e invalidaria o cache de avaliações já
 * pagas. Duplicação deliberada.
 *
 * NÃO é gerado: o `sync-constants` só traz do banco os ids (`ExternalSourceId`) e a
 * ordem (`EXTERNAL_SOURCE_ORDER`); a tabela `source` não tem coluna de rótulo. Ao
 * adicionar uma fonte, acrescente o nome aqui — o fallback é o próprio id.
 */
const SOURCE_LABELS: Record<string, string> = {
  anilist: "AniList",
  mangaupdates: "MangaUpdates",
  myanimelist: "MyAnimeList",
  kitsu: "Kitsu",
  mangadex: "MangaDex",
  comick: "ComicK",
  animeplanet: "AnimePlanet",
  comix: "Comix",
  mangago: "Mangago",
  outros: "Outros",
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

export { SOURCE_LABELS }
