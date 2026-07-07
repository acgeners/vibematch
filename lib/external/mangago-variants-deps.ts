import { fetchAniListById } from "./anilist"
import { fetchJikanMangaById } from "./jikan"
import { fetchMangaUpdatesById } from "./mangaupdates"
import type { MangagoVariantDeps, SourceTitles } from "./mangago-variants"

/**
 * Wiring dos fetchers REAIS para `buildResolveVariants`. Mantido separado da
 * lógica pura (`mangago-variants.ts`) para (1) manter o unit test sem tocar em
 * rede e (2) deixar claro que isto está PREPARADO mas ainda NÃO integrado ao
 * fluxo — o `resolveMangagoUrl` só usa isto quem o chamar em produção decidir.
 *
 * Os fetchers já existem no repo e devolvem `{ title, alternativeTitles[], year }`
 * (AniList também `originalTitle` = native). Mapeamos para `SourceTitles`.
 */
export const defaultVariantDeps: MangagoVariantDeps = {
  anilist: async (id: number): Promise<SourceTitles | null> => {
    const m = await fetchAniListById(id)
    if (!m) return null
    return {
      primary: m.title || undefined,
      native: m.originalTitle,
      aliases: m.alternativeTitles,
      year: m.year,
    }
  },
  mal: async (id: number): Promise<SourceTitles | null> => {
    const m = await fetchJikanMangaById(id)
    if (!m) return null
    return { primary: m.title || undefined, aliases: m.alternativeTitles, year: m.year }
  },
  mangaUpdates: async (id: string | number): Promise<SourceTitles | null> => {
    const numeric = Number(id)
    if (!Number.isFinite(numeric)) return null
    const m = await fetchMangaUpdatesById(numeric)
    if (!m) return null
    return { primary: m.title || undefined, aliases: m.alternativeTitles, year: m.year }
  },
}
