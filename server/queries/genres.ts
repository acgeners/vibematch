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
