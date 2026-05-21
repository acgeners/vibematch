import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"

export interface TagOption {
  slug: string
  name: string
  tag_group_id: string | null
  groupName: string
}

export const getAllTags = unstable_cache(
  async (): Promise<TagOption[]> => {
    const supabase = createAdminClient()
    const PAGE = 1000
    const allTags: Array<{ slug: string; name: string; tag_group_id: string | null }> = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("tags")
        .select("slug, name, tag_group_id")
        .order("name")
        .range(offset, offset + PAGE - 1)
      if (error) break
      if (!data || data.length === 0) break
      for (const row of data) {
        allTags.push({
          slug: row.slug,
          name: row.name,
          tag_group_id: row.tag_group_id ?? null,
        })
      }
      if (data.length < PAGE) break
    }

    const { data: groups } = await supabase.from("tag_group").select("id, group, slug")
    const groupById = new Map(
      (groups ?? []).map((group) => [
        group.id as string,
        ((group.group as string | null) ?? (group.slug as string | null) ?? "Sem grupo"),
      ])
    )
    return allTags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      tag_group_id: tag.tag_group_id,
      groupName: tag.tag_group_id ? groupById.get(tag.tag_group_id) ?? "Sem grupo" : "Sem grupo",
    }))
  },
  ["all-tags-v1"],
  { revalidate: 300, tags: ["tags-catalog"] }
)
