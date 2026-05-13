"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { searchAllSources, fetchMultiSourceDetails } from "@/lib/external/index"
import type { MergedCandidate, TagSuggestion, ExternalWorkData, ConflictField } from "@/lib/external/types"

export interface TagCatalogItem {
  id: string
  name: string
  slug: string
  tag_group_id: string | null
  groupSlug: string
  groupLabel: string
}

const TAG_GROUP_ID_TO_SLUG = Object.fromEntries(
  Object.entries(TAG_GROUP_IDS).map(([slug, id]) => [id, slug])
) as Record<string, TagGroupSlug>

export async function listTagCatalog(): Promise<TagCatalogItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, slug, tag_group_id")
    .order("name")

  if (error || !data) return []

  return data.map((tag) => {
    const groupSlug = tag.tag_group_id ? (TAG_GROUP_ID_TO_SLUG[tag.tag_group_id] ?? "") : ""
    const groupLabel = groupSlug ? (TAG_GROUP_LABELS[groupSlug as TagGroupSlug] ?? groupSlug) : ""
    return {
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      tag_group_id: tag.tag_group_id,
      groupSlug,
      groupLabel,
    }
  })
}

export async function searchExternalTitles(query: string): Promise<MergedCandidate[]> {
  return searchAllSources(query)
}

function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export async function fetchExternalData(
  candidate: MergedCandidate
): Promise<{ data: ExternalWorkData; conflicts: ConflictField[] }> {
  const [result, catalog] = await Promise.all([
    fetchMultiSourceDetails(candidate),
    listTagCatalog(),
  ])
  const catalogByKey = new Map(catalog.map((t) => [normalizeTagKey(t.name), t.name]))
  const genres = result.data.genres.map((g) => catalogByKey.get(normalizeTagKey(g)) ?? g)
  return { data: { ...result.data, genres }, conflicts: result.conflicts }
}

export async function upsertExternalTags(tagNames: string[]): Promise<void> {
  if (!tagNames.length) return
  const supabase = createAdminClient()
  const rows = tagNames.map((name) => ({
    name: name.trim(),
    slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  }))
  await supabase
    .from("tags")
    .upsert(rows, { onConflict: "slug", ignoreDuplicates: true })
}

export async function listExternalSources() {
  return Object.entries(PLATFORM_LABELS).map(([slug, name], index) => ({
    id: index + 1,
    slug,
    name,
    order: index + 1,
  }))
}

export async function searchTags(query: string): Promise<TagSuggestion[]> {
  void query
  return []
}
