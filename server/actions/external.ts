"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG, normalizeTagGroupSlug } from "@/lib/constants/tag-groups-utils"
import { TAG_GROUPS_CATALOG, GENRE_NAMES } from "@/lib/constants/tags"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { searchAllSources, fetchMultiSourceDetails, fetchExternalEvaluationContextForWork, fetchExternalEvaluationContextForCandidate, buildCandidateFromExternalIds, SEARCH_CONNECTORS, bestTitleMatch } from "@/lib/external/index"
import { requestAiEvaluation, type AiEvaluationTag } from "@/lib/ai-evaluation/service"
import { classifyTagsByGroup } from "@/lib/ai-evaluation/tag-classifier"
import type { ExternalSourceId, MergedCandidate, TagSuggestion, ExternalWorkData, ConflictField } from "@/lib/external/types"
import type { CriterionSlug } from "@/types/domain"
import { revalidatePath } from "next/cache"
import { pickPrimaryCover } from "@/lib/work-derived"
import { slugifyTagName } from "@/lib/utils"

export interface TagCatalogItem {
  id: string
  name: string
  slug: string
  tag_group_id: string | null
  groupSlug: string
  groupLabel: string
}

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
    const groupSlug = tag.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[tag.tag_group_id] ?? "") : ""
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

const TAG_GROUP_BY_TAG_KEY: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const group of TAG_GROUPS_CATALOG) {
    const groupSlug = normalizeTagGroupSlug(group.groupSlug)
    if (!groupSlug) continue
    for (const name of group.values) {
      map.set(normalizeTagKey(name), groupSlug)
    }
  }
  return map
})()

function tagsForAi(tagNames: string[] | undefined): AiEvaluationTag[] {
  const seen = new Set<string>()
  const out: AiEvaluationTag[] = []
  for (const raw of tagNames ?? []) {
    const name = raw.trim()
    const key = normalizeTagKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    out.push({ name, group: TAG_GROUP_BY_TAG_KEY.get(key) ?? null })
  }
  return out
}

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
    slug: slugifyTagName(name),
  })).filter((r) => r.slug)

  if (rows.length === 0) return

  const slugs = rows.map((r) => r.slug)

  // Resolve aliases — incoming slugs may already be known under canonical form.
  const { data: aliasRows } = await supabase
    .from("tag_alias")
    .select("alias_slug")
    .in("alias_slug", slugs)
  const aliasedSlugs = new Set((aliasRows ?? []).map((row) => row.alias_slug as string))

  // Then identify existing canonical tags so we don't reclassify them.
  const { data: existing } = await supabase
    .from("tags")
    .select("slug")
    .in("slug", slugs)
  const existingSlugs = new Set((existing ?? []).map((row) => row.slug))

  const newRows = rows.filter((r) => !existingSlugs.has(r.slug) && !aliasedSlugs.has(r.slug))
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
  coverUrl?: string | null
  externalIds?: Partial<Record<ExternalSourceId, string>>
  externalContext?: string[]
}): Promise<CandidateAiResult | null> {
  try {
    const hasExternalIds = input.externalIds && Object.values(input.externalIds).some(Boolean)
    const contextResult = hasExternalIds
      ? await fetchExternalEvaluationContextForCandidate(
          buildCandidateFromExternalIds({
            title: input.title,
            originalTitle: input.originalTitle ?? null,
            alternativeTitles: input.alternativeTitles ?? null,
          }, input.externalIds ?? {}),
          { perSource: 4, total: 12 }
        )
      : await fetchExternalEvaluationContextForWork({
          title: input.title,
          originalTitle: input.originalTitle ?? null,
          alternativeTitles: input.alternativeTitles ?? null,
        })
    const externalContext = input.externalContext ?? contextResult.externalContext

    const response = await requestAiEvaluation({
      workId: `external:${input.title}`,
      title: input.title,
      synopsis: input.synopsis ?? undefined,
      genres: input.genres ?? [],
      tags: tagsForAi(input.tags),
      sourcedReviews: contextResult.sourcedReviews,
      externalContext,
      coverUrl: input.coverUrl ?? null,
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

// ============================================================================
// Revalidação de fontes externas (fix de match errado em obras já criadas)
// ============================================================================

export interface SourceCandidateOption {
  externalId: string
  title: string
  coverUrl: string | null
  matchScore: number
  synopsis: string | null
  year: number | null
  chapters: number | null
}

export interface CurrentSourceSelection {
  source: ExternalSourceId
  externalId: string | null
  isRejected: boolean
}

export interface RevalidateSourcesResult {
  query: string
  candidatesPerSource: Partial<Record<ExternalSourceId, SourceCandidateOption[]>>
  currentSelections: CurrentSourceSelection[]
}

export interface SourceSelectionInput {
  source: ExternalSourceId
  externalId: string | null
  isRejected: boolean
}

function animePlanetSlugFromTitle(title: string): string | null {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  return slug || null
}

function addAnimePlanetFallbackCandidate(
  candidatesPerSource: Partial<Record<ExternalSourceId, SourceCandidateOption[]>>,
  queries: string[],
  fallbackCoverUrl: string | null
) {
  if (candidatesPerSource.animeplanet?.length) return

  const title = queries[0]?.trim()
  if (!title) return

  const slug = animePlanetSlugFromTitle(title)
  if (!slug) return

  candidatesPerSource.animeplanet = [{
    externalId: slug,
    title,
    coverUrl: fallbackCoverUrl,
    matchScore: 0.95,
    synopsis: null,
    year: null,
    chapters: null,
  }]
}

/**
 * Busca candidatos por fonte pra UI de revalidação. Top 3 por fonte com
 * matchScore ≥ 0.65 (mesmo limiar inicial do mergeSearchResults). Marca
 * as seleções atuais via work_external_ids.
 */
export async function revalidateWorkSources(workId: string): Promise<{ data?: RevalidateSourcesResult; error?: string }> {
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select("id, title, original_title, alternative_titles, work_covers(url, is_primary, position)")
    .eq("id", workId)
    .single()

  if (workError || !work) return { error: "Obra não encontrada" }

  const queries: string[] = []
  const pushUnique = (s: string | null | undefined) => {
    const t = s?.trim()
    if (t && !queries.includes(t)) queries.push(t)
  }
  pushUnique(work.title)
  pushUnique(work.original_title as string | null)
  for (const alt of (work.alternative_titles as string[] | null) ?? []) pushUnique(alt)

  const primaryQuery = queries[0]
  if (!primaryQuery) return { error: "Obra sem título pra buscar" }

  // Executa search bruto por fonte em paralelo (mantém raw results pra UI).
  const settled = await Promise.allSettled(
    SEARCH_CONNECTORS.map((connector) => connector.search(primaryQuery))
  )

  const candidatesPerSource: Partial<Record<ExternalSourceId, SourceCandidateOption[]>> = {}
  settled.forEach((entry, i) => {
    const source = SEARCH_CONNECTORS[i].source
    if (entry.status !== "fulfilled") return
    const scored = entry.value
      .map((result) => {
        const matchScore = Math.max(
          ...queries.map((q) => bestTitleMatch(q, result)),
          0
        )
        return { result, matchScore }
      })
      .filter(({ matchScore }) => matchScore >= 0.5) // mostra mais opções pra revalidação
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3)
    if (scored.length === 0) return
    candidatesPerSource[source] = scored.map(({ result, matchScore }) => ({
      externalId: result.id.split(":")[1] ?? result.id,
      title: result.title,
      coverUrl: result.coverUrl ?? null,
      matchScore,
      synopsis: result.synopsis ?? null,
      year: result.year ?? null,
      chapters: result.chapters ?? null,
    }))
  })

  // AnimePlanet é frequentemente bloqueado por Cloudflare em server-side fetch.
  // Na revalidação o usuário já está conferindo manualmente, então mostramos um
  // candidato de slug canônico quando a busca HTML não conseguiu retornar cards.
  addAnimePlanetFallbackCandidate(
    candidatesPerSource,
    queries,
    pickPrimaryCover(work.work_covers)
  )

  // Carrega seleções atuais pra pré-marcar UI.
  const { data: existing } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", workId)

  const currentSelections: CurrentSourceSelection[] = (existing ?? []).map((row) => ({
    source: row.source as ExternalSourceId,
    externalId: row.external_id as string | null,
    isRejected: Boolean(row.is_rejected),
  }))

  return {
    data: {
      query: primaryQuery,
      candidatesPerSource,
      currentSelections,
    },
  }
}

/**
 * Persiste seleções do usuário em work_external_ids. Pra cada source no array:
 *   - externalId + !rejected → upsert (linha ativa)
 *   - rejected (com ou sem id) → upsert is_rejected=true
 *   - "limpar" uma fonte (não enviar no array) → delete da linha existente
 *
 * Esse endpoint NÃO dispara refresh de dados nem reavaliação IA — UI controla.
 */
export async function saveWorkSourceSelections(
  workId: string,
  selections: SourceSelectionInput[]
): Promise<{ error?: string }> {
  const supabase = createAdminClient()

  const rowsToUpsert = selections.map((s) => ({
    work_id: workId,
    source: s.source,
    external_id: s.externalId,
    is_rejected: s.isRejected,
  }))

  // Sources presentes no payload → upsert. Sources ausentes → delete (volta a "não avaliada").
  const presentSources = new Set(selections.map((s) => s.source))
  const { data: existing } = await supabase
    .from("work_external_ids")
    .select("source")
    .eq("work_id", workId)
  const toDelete = (existing ?? [])
    .map((r) => r.source as ExternalSourceId)
    .filter((s) => !presentSources.has(s))

  if (toDelete.length > 0) {
    const { error: delError } = await supabase
      .from("work_external_ids")
      .delete()
      .eq("work_id", workId)
      .in("source", toDelete)
    if (delError) return { error: `Erro ao limpar fontes: ${delError.message}` }
  }

  if (rowsToUpsert.length > 0) {
    const { error: upError } = await supabase
      .from("work_external_ids")
      .upsert(rowsToUpsert, { onConflict: "work_id,source" })
    if (upError) return { error: `Erro ao salvar seleções: ${upError.message}` }
  }

  revalidatePath(`/titles/${workId}`)
  return {}
}
