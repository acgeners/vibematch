import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { titleToSlug } from "@/lib/utils"
import { pickPrimaryCover } from "@/lib/work-derived"
import { getPublicationStatusNameById } from "@/lib/constants/status-lookups"
import { getHideAdultContent } from "@/server/queries/current-user"
import { titleTokens, workMatchesQuery, matchedAliasFor, matchTier } from "@/lib/title-match"

/** Uma sugestão do dropdown de busca ao vivo de /catalog. */
export interface WorkSuggestion {
  id: string
  title: string
  slug: string
  coverUrl: string | null
  totalChapters: number | null
  year: number | null
  publicationStatus: string | null
  isAdult: boolean
  /**
   * O título alternativo que casou a busca — só quando NÃO foi o título principal.
   * Sem isto o dropdown mostra um nome sem relação nenhuma com o que foi digitado.
   */
  matchedAlias: string | null
}

interface IndexRow {
  id: string
  title: string | null
  original_title: string | null
  alternative_titles: string[] | null
  is_adult: boolean | null
  total_chapters: number | null
  year: number | null
  publication_status_id: number | null
}

/**
 * Índice de nomes do catálogo, cacheado. Sem ele cada tecla digitada faria um
 * full-scan de `works` contra o DB.
 *
 * Deliberadamente SEM capas: manter o blob pequeno importa mais aqui do que
 * poupar uma query — as capas são buscadas depois, só pros ~8 ids que sobraram.
 *
 * Invalidado pela mesma tag do índice slug→id (`works-slug-index`), que as
 * actions de mutação de obra já disparam.
 */
const getSuggestionIndex = unstable_cache(
  async (): Promise<IndexRow[]> => {
    const supabase = createAdminClient()
    // Pagina: `.select()` corta em 1000 linhas sem avisar, e a cauda do catálogo
    // sumiria da busca em silêncio — o bug que este PR existe pra matar.
    return fetchAllRows<IndexRow>(
      (from, to) =>
        supabase
          .from("works")
          .select(
            "id, title, original_title, alternative_titles, is_adult, total_chapters, year, publication_status_id",
          )
          .eq("is_archived", false)
          .range(from, to),
      "getSuggestionIndex",
    )
  },
  ["work-suggestion-index-v1"],
  { revalidate: 300, tags: ["works-slug-index"] },
)

/** Teto de sugestões devolvidas. O dropdown não é a lista — é o atalho. */
const DEFAULT_LIMIT = 8

/**
 * Busca incremental por nome, para o dropdown de /catalog. Casa title,
 * original_title E alternative_titles com a normalização compartilhada
 * (lib/title-match.ts) — a mesma da detecção de duplicata.
 *
 * Respeita a preferência global "ocultar 18+": quem optou por esconder não deve
 * ver obra adulta reaparecer pelo atalho de busca.
 */
export async function getWorkSuggestions(
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<WorkSuggestion[]> {
  const tokens = titleTokens(query)
  if (!tokens.length) return []

  const [index, hideAdult] = await Promise.all([getSuggestionIndex(), getHideAdultContent()])

  const matches = index
    .filter((row) => (hideAdult ? !row.is_adult : true))
    .filter((row) => workMatchesQuery(row, tokens))

  if (!matches.length) return []

  // Ordena por qualidade do casamento e, dentro da faixa, por título — assim o
  // resultado é estável entre teclas em vez de dançar na tela.
  const ranked = matches
    .map((row) => ({ row, tier: matchTier(row, query) }))
    .sort((a, b) => b.tier - a.tier || (a.row.title ?? "").localeCompare(b.row.title ?? ""))
    .slice(0, limit)

  const ids = ranked.map((m) => m.row.id)
  const supabase = createAdminClient()
  const { data: coverRows } = await supabase
    .from("work_covers")
    .select("work_id, url, is_primary, position")
    .in("work_id", ids)

  const coversByWork = new Map<string, Array<{ url: string; is_primary: boolean; position: number | null }>>()
  for (const c of coverRows ?? []) {
    const list = coversByWork.get(c.work_id) ?? []
    list.push({ url: c.url, is_primary: c.is_primary, position: c.position })
    coversByWork.set(c.work_id, list)
  }

  return ranked.map(({ row }) => {
    const title = row.title ?? "(sem título)"
    return {
      id: row.id,
      title,
      slug: titleToSlug(title),
      coverUrl: pickPrimaryCover(coversByWork.get(row.id)),
      totalChapters: row.total_chapters,
      year: row.year,
      publicationStatus: row.publication_status_id
        ? getPublicationStatusNameById(row.publication_status_id)
        : null,
      isAdult: Boolean(row.is_adult),
      matchedAlias: matchedAliasFor(row, tokens),
    }
  })
}
