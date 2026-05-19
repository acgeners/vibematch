import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"

export function normalizeTagGroupSlug(slug: string | null | undefined): string | null {
  const normalized = slug?.replace(/^\uFEFF/, "").trim()
  return normalized ? normalized : null
}

export const TAG_GROUP_ID_TO_NORMALIZED_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_GROUP_IDS).map(([slug, id]) => [id, normalizeTagGroupSlug(slug) ?? slug])
)
