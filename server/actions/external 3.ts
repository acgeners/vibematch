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

type GenreJoinRow = {
  id: string
  tag_id: string | null
  tags?: {
    id?: string
    name?: string
    slug?: string
    tag_group_id?: string | null
  } | null
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

  if (error) {
    console.error("[listTagCatalog] supabase query failed", error.message)
    return []
  }
  if (!data) return []

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

export async function listGenreCatalog(): Promise<TagCatalogItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("genres")
    .select("id, tag_id, tags(id, name, slug, tag_group_id)")

  if (error) {
    console.error("[listGenreCatalog] genres query failed, falling back to tags filter", error.message)
  }
  if (!error && data) {
    return (data as GenreJoinRow[])
      .map((row) => row.tags)
      .filter((tag): tag is NonNullable<GenreJoinRow["tags"]> => Boolean(tag?.name))
      .map((tag) => ({
        id: tag.id ?? "",
        name: tag.name ?? "",
        slug: tag.slug ?? "",
        tag_group_id: tag.tag_group_id ?? null,
        groupSlug: "genre",
        groupLabel: TAG_GROUP_LABELS.genre,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const all = await listTagCatalog()
  return all.filter((t) => t.groupSlug === "genre")
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
  const [resultSettled, tagSettled, genreSettled] = await Promise.allSettled([
    fetchMultiSourceDetails(candidate),
    listTagCatalog(),
    listGenreCatalog(),
  ])

  if (resultSettled.status === "rejected") {
    console.error("[fetchExternalData] fetchMultiSourceDetails failed", resultSettled.reason)
    throw resultSettled.reason
  }
  if (tagSettled.status === "rejected") {
    console.error("[fetchExternalData] listTagCatalog failed", tagSettled.reason)
  }
  if (genreSettled.status === "rejected") {
    console.error("[fetchExternalData] listGenreCatalog failed", genreSettled.reason)
  }

  const result = resultSettled.value
  const tagCatalog = tagSettled.status === "fulfilled" ? tagSettled.value : []
  const genreCatalog = genreSettled.status === "fulfilled" ? genreSettled.value : []
  const tagCatalogByKey = new Map(tagCatalog.map((t) => [normalizeTagKey(t.name), t.name]))
  const genreCatalogByKey = new Map(genreCatalog.map((t) => [normalizeTagKey(t.name), t.name]))
  const genres = result.data.genres.flatMap((g) => {
    const name = genreCatalogByKey.get(normalizeTagKey(g))
    return name ? [name] : []
  })
  const tags = result.data.tags.map((t) => tagCatalogByKey.get(normalizeTagKey(t)) ?? t)
  return { data: { ...result.data, genres, tags }, conflicts: result.conflicts }
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
