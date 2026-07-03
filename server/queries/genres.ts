import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"

export const getAllGenres = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("genres")
      .select("name")
      .order("name")
      .limit(1000)
    return (data ?? [])
      .map((row) => row.name as string | null)
      .filter((name): name is string => Boolean(name))
  },
  ["all-genres-v1"],
  { revalidate: 300, tags: ["genres-catalog"] }
)

/**
 * Mapa name → cat_type ('category' | 'demographics') da tabela `genres`. Usado
 * pela aba Gêneros do filtro pra separar Demografia (Josei/Shoujo…) dos gêneros.
 * Default 'category' quando cat_type é nulo.
 */
export const getGenreCatTypes = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("genres")
      .select("name, cat_type")
      .limit(1000)
    const map: Record<string, string> = {}
    for (const row of data ?? []) {
      const name = row.name as string | null
      if (name) map[name] = (row.cat_type as string | null) ?? "category"
    }
    return map
  },
  ["genre-cat-types-v1"],
  { revalidate: 300, tags: ["genres-catalog"] }
)
