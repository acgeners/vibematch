"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_IDS, TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUPS_CATALOG, GENRE_NAMES } from "@/lib/constants/tags"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { searchAllSources, fetchMultiSourceDetails, fetchExternalEvaluationContextForWork } from "@/lib/external/index"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import { classifyTagsByGroup } from "@/lib/ai-evaluation/tag-classifier"
import type { MergedCandidate, TagSuggestion, ExternalWorkData, ConflictField } from "@/lib/external/types"
import type { CriterionSlug } from "@/types/domain"

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
    .limit(10000)

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
    .select("id, name, slug")
    .order("name")
    .limit(10000)

  if (error) {
    console.error("[listGenreCatalog] genres query failed", error.message)
    return []
  }
  return (data ?? [])
    .filter((row): row is { id: string; name: string; slug: string | null } => Boolean(row.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug ?? "",
      tag_group_id: null,
      groupSlug: "genre",
      groupLabel: "Gênero",
    }))
}

export async function searchExternalTitles(query: string): Promise<MergedCandidate[]> {
  return searchAllSources(query)
}

export interface ExistingWorkMatch {
  id: string
  title: string
  originalTitle: string | null
  alternativeTitles: string[]
  matchType: "exact_title" | "original_title" | "exact_alt" | "fuzzy"
  similarity: number
}

/**
 * Looks up potential duplicates in the DB for a candidate the user is about to
 * import. Combines exact match on title / original_title / alternative_titles
 * with pg_trgm fuzzy match on title (≥ 0.70 similarity). Uses the SQL function
 * find_works_matching_titles (migration 015).
 */
export async function checkExistingWorkInDb(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}): Promise<ExistingWorkMatch[]> {
  const seen = new Set<string>()
  const titles: string[] = []
  for (const value of [input.title, input.originalTitle, ...(input.alternativeTitles ?? [])]) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(trimmed)
  }
  if (titles.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("find_works_matching_titles", { query_titles: titles })

  if (error) {
    console.error("[checkExistingWorkInDb] rpc failed", error.message)
    return []
  }
  if (!data) return []

  return (data as Array<{
    id: string
    title: string
    original_title: string | null
    alternative_titles: string[] | null
    match_type: ExistingWorkMatch["matchType"]
    similarity: number
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    alternativeTitles: row.alternative_titles ?? [],
    matchType: row.match_type,
    similarity: row.similarity,
  }))
}

function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

const TAG_NAME_BY_KEY: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const group of TAG_GROUPS_CATALOG) {
    for (const name of group.values) {
      map.set(normalizeTagKey(name), name)
    }
  }
  return map
})()

const GENRE_NAME_BY_KEY: Map<string, string> = new Map(
  GENRE_NAMES.map((name) => [normalizeTagKey(name), name])
)

export async function fetchExternalData(
  candidate: MergedCandidate
): Promise<{ data: ExternalWorkData; conflicts: ConflictField[] }> {
  const result = await fetchMultiSourceDetails(candidate)
  const tagCatalogByKey = TAG_NAME_BY_KEY
  const genreCatalogByKey = GENRE_NAME_BY_KEY

  const genres: string[] = []
  const tagsFromGenresField: string[] = []
  for (const g of result.data.genres) {
    const key = normalizeTagKey(g)
    const genreName = genreCatalogByKey.get(key)
    if (genreName) {
      genres.push(genreName)
      continue
    }
    const tagName = tagCatalogByKey.get(key)
    if (tagName) tagsFromGenresField.push(tagName)
  }
  const tagsFromSources = result.data.tags.flatMap((t) => {
    const name = tagCatalogByKey.get(normalizeTagKey(t))
    return name ? [name] : []
  })
  const seen = new Set<string>()
  const tags: string[] = []
  for (const name of [...tagsFromGenresField, ...tagsFromSources]) {
    const key = normalizeTagKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    tags.push(name)
  }

  return { data: { ...result.data, genres, tags }, conflicts: result.conflicts }
}

export async function upsertExternalTags(tagNames: string[]): Promise<void> {
  if (!tagNames.length) return
  const supabase = createAdminClient()

  const rows = tagNames.map((name) => ({
    name: name.trim(),
    slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  })).filter((r) => r.slug)

  if (rows.length === 0) return

  // Identifica quais slugs já existem para evitar tocar nas tags existentes
  // (não sobrescreve tag_group_id já definido manualmente).
  const { data: existing } = await supabase
    .from("tags")
    .select("slug")
    .in("slug", rows.map((r) => r.slug))
  const existingSlugs = new Set((existing ?? []).map((row) => row.slug))

  const newRows = rows.filter((r) => !existingSlugs.has(r.slug))
  if (newRows.length === 0) return

  // Classifica tags novas em tag_groups via IA antes de inserir. Tags que não
  // são classificáveis caem no grupo "Other".
  const classification = await classifyTagsByGroup({
    tagNames: newRows.map((r) => r.name),
  })

  const rowsToInsert = newRows.map((r) => ({
    name: r.name,
    slug: r.slug,
    tag_group_id: classification.byName.get(r.name) ?? classification.fallbackGroupId,
  }))

  await supabase
    .from("tags")
    .upsert(rowsToInsert, { onConflict: "slug", ignoreDuplicates: true })
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

// ============================================================================
// AI evaluation during the create flow (✨ Buscar dados)
// ============================================================================

export interface CandidateAiResult {
  scores: Partial<Record<CriterionSlug, number>>
  justifications: Partial<Record<CriterionSlug, string>>
  summary: string
  confidence: number
  modelName: string
  promptVersion: string
  /** Hash canônico do input — propagado pra ai_evaluations.input_hash no createWork. */
  inputHash: string
}

/**
 * Server action used ONLY by the create-work flow (external-search → Buscar dados).
 * Runs the AI evaluation against the candidate metadata so the form is already
 * pre-filled with the 9 criterion scores by the time the user clicks "Salvar".
 *
 * The existing post-save evaluation flow ([triggerAiEvaluation] in server/actions/ai.ts,
 * used by /ai-evaluation and the "Reavaliar AI" button) is intentionally NOT changed.
 * Both paths converge on [requestAiEvaluation] but at different lifecycle points.
 *
 * Fails soft: any error returns null so the create flow continues without AI.
 */
export async function evaluateCandidateForCreate(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
  synopsis?: string | null
  genres?: string[]
  tags?: string[]
}): Promise<CandidateAiResult | null> {
  try {
    const { sourcedReviews, externalContext } = await fetchExternalEvaluationContextForWork({
      title: input.title,
      originalTitle: input.originalTitle ?? null,
      alternativeTitles: input.alternativeTitles ?? null,
    })

    const response = await requestAiEvaluation({
      workId: `external:${input.title}`,
      title: input.title,
      synopsis: input.synopsis ?? undefined,
      genres: input.genres ?? [],
      tags: input.tags ?? [],
      sourcedReviews,
      externalContext,
    })

    const scores: Partial<Record<CriterionSlug, number>> = {}
    const justifications: Partial<Record<CriterionSlug, string>> = {}
    for (const entry of response.scores) {
      const value = Number(entry.suggestedScore)
      if (Number.isFinite(value)) {
        scores[entry.criterionSlug as CriterionSlug] = Math.round(value * 10) / 10
      }
      if (entry.justification?.trim()) {
        justifications[entry.criterionSlug as CriterionSlug] = entry.justification.trim()
      }
    }

    return {
      scores,
      justifications,
      summary: response.summary,
      confidence: response.confidence,
      modelName: response.modelName,
      promptVersion: response.promptVersion,
      inputHash: response.inputHash,
    }
  } catch (err) {
    console.error("[evaluateCandidateForCreate] failed", err)
    return null
  }
}
