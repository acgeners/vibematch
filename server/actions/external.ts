"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG, normalizeTagGroupSlug } from "@/lib/constants/tag-groups-utils"
import { TAG_GROUPS_CATALOG, GENRE_NAMES } from "@/lib/constants/tags"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { searchAllSources, fetchMultiSourceDetails, fetchExternalEvaluationContextForWork, fetchExternalEvaluationContextForCandidate, buildCandidateFromExternalIds, SEARCH_CONNECTORS, bestTitleMatch } from "@/lib/external/index"
import { fetchMangaUpdatesAlternativeTitles } from "@/lib/external/mangaupdates"
import { AI_EVAL_REVIEW_CAPS, requestAiEvaluation, type AiEvaluationTag } from "@/lib/ai-evaluation/service"
import { classifyTagsByGroup } from "@/lib/ai-evaluation/tag-classifier"
import type { ExternalSourceId, MergedCandidate, TagSuggestion, ExternalWorkData, ConflictField, SourcedReview, ExternalSearchResult } from "@/lib/external/types"
import type { CriterionSlug } from "@/types/domain"
import { revalidatePath } from "next/cache"
import { pickPrimaryCover } from "@/lib/work-derived"
import { slugifyTagName } from "@/lib/utils"
import { isBlockedCoverUrl } from "@/lib/external/blocked-covers"

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
  /** Pool completo de reviews coletado durante a avaliação. O client carrega
   * isto até o createWork, que persiste em work_reviews após a obra ser criada. */
  externalReviews: SourcedReview[]
  /** Diagnóstico de por que não há reviews externas no prompt. null quando ao menos 1 review foi enviada. */
  noReviewsReason: "no_external_ids" | "all_rejected" | "search_miss" | "sources_returned_empty" | null
}

/**
 * Server action used ONLY by the create-work flow (external-search → Buscar dados).
 * Runs the AI evaluation against the candidate metadata so the form is already
 * pre-filled with the 9 criterion scores by the time the user clicks "Salvar".
 *
 * The existing post-save evaluation flow ([triggerAiEvaluation] in server/actions/ai.ts,
 * used by /ai-evaluation and the "Reavaliar AI" button) converges on the same
 * [requestAiEvaluation] with the same [AI_EVAL_REVIEW_CAPS], so a given input
 * produces the same hash and hits the same cache entry across both flows.
 *
 * Errors propagate to the caller so the wizard can surface them to the user.
 * The caller is responsible for deciding whether to continue without scores.
 */
const CREATE_FLOW_OPUS_ID = "claude-opus-4-7"
const CREATE_FLOW_SONNET_ID = "claude-sonnet-4-6"

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
  /** Override do modelo Claude. Default usa o MODEL configurado no service. */
  model?: "sonnet" | "opus"
}): Promise<CandidateAiResult> {
  const externalIdEntries = Object.entries(input.externalIds ?? {}).filter(([, id]) => Boolean(id))
  const hasExternalIds = externalIdEntries.length > 0
  const contextResult = hasExternalIds
    ? await fetchExternalEvaluationContextForCandidate(
        buildCandidateFromExternalIds({
          title: input.title,
          originalTitle: input.originalTitle ?? null,
          alternativeTitles: input.alternativeTitles ?? null,
        }, input.externalIds ?? {}),
        { ...AI_EVAL_REVIEW_CAPS }
      )
    : await fetchExternalEvaluationContextForWork({
        title: input.title,
        originalTitle: input.originalTitle ?? null,
        alternativeTitles: input.alternativeTitles ?? null,
      })
  const externalContext = input.externalContext ?? contextResult.externalContext

  const modelOverride =
    input.model === "opus"
      ? CREATE_FLOW_OPUS_ID
      : input.model === "sonnet"
        ? CREATE_FLOW_SONNET_ID
        : undefined

  const response = await requestAiEvaluation({
    workId: `external:${input.title}`,
    title: input.title,
    synopsis: input.synopsis ?? undefined,
    genres: input.genres ?? [],
    tags: tagsForAi(input.tags),
    sourcedReviews: contextResult.sourcedReviews,
    externalContext,
    platformRatings: contextResult.platformRatings,
    similarWorks: contextResult.similarWorks,
    coverUrl: input.coverUrl ?? null,
    model: modelOverride,
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

  // Aqui o create flow não tem ainda `work_external_ids` no DB; o conceito de
  // "rejeitado" (is_rejected) só existe pós-criação via "Revalidar fontes".
  // Por isso só distinguimos três casos no create — `all_rejected` é
  // exclusivo do Path A.
  const noReviewsReason: CandidateAiResult["noReviewsReason"] =
    (contextResult.sourcedReviews?.length ?? 0) > 0
      ? null
      : hasExternalIds
        ? "sources_returned_empty"
        : "search_miss"

  return {
    scores,
    justifications,
    summary: response.summary,
    confidence: response.confidence,
    modelName: response.modelName,
    promptVersion: response.promptVersion,
    inputHash: response.inputHash,
    externalReviews: contextResult.allReviews ?? [],
    noReviewsReason,
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

// Quando uma fonte aponta pra um CDN bloqueado por Cloudflare (ver
// lib/external/blocked-covers), tentamos achar a mesma obra em outra fonte
// via crossIds e roubamos a cover dela (CDNs como AniList são abertos).
const CROSS_SOURCE_PRIORITY: ExternalSourceId[] = ["anilist", "myanimelist", "mangadex", "mangaupdates"]

function resolveCrossSourceCover(
  result: ExternalSearchResult,
  rawBySource: Map<ExternalSourceId, ExternalSearchResult[]>
): string | null {
  const crossIds = result.crossIds
  if (!crossIds) return null
  for (const altSource of CROSS_SOURCE_PRIORITY) {
    const externalId = crossIds[altSource]
    if (!externalId) continue
    const candidates = rawBySource.get(altSource) ?? []
    const match = candidates.find(
      (r) => r.id === `${altSource}:${externalId}` && r.coverUrl && !isBlockedCoverUrl(r.coverUrl)
    )
    if (match?.coverUrl) return match.coverUrl
  }
  return null
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

  // Threshold pra considerar uma fonte "bem servida" pela busca primária.
  // Abaixo disso, refazemos a busca com original_title + alt titles.
  const STRONG_MATCH = 0.72
  const KEEP_MATCH = 0.5
  const MAX_RETRY_VARIANTS = 5

  const scoreAgainst = (variants: string[], result: ExternalSearchResult) =>
    Math.max(...variants.map((q) => bestTitleMatch(q, result)), 0)

  // Pass 1: busca primária por fonte.
  const primarySettled = await Promise.allSettled(
    SEARCH_CONNECTORS.map((connector) => connector.search(primaryQuery))
  )
  const rawBySource = new Map<ExternalSourceId, ExternalSearchResult[]>()
  primarySettled.forEach((entry, i) => {
    const source = SEARCH_CONNECTORS[i].source
    if (entry.status === "fulfilled") rawBySource.set(source, entry.value)
  })

  // Coleta variantes: do work + dos top matches fortes da Pass 1 (resolve o caso
  // onde a obra no banco não tem alt_titles preenchidos mas alguma fonte já achou
  // a obra certa e expôs seus títulos alternativos).
  const variantSet = new Set<string>(queries)
  let muTopId: number | null = null
  for (const [source, results] of rawBySource) {
    if (results.length === 0) continue
    const top = results
      .map((r) => ({ r, s: scoreAgainst(queries, r) }))
      .sort((a, b) => b.s - a.s)[0]
    if (!top || top.s < STRONG_MATCH) continue
    const harvested = [top.r.title, top.r.originalTitle, ...(top.r.alternativeTitles ?? [])]
    for (const t of harvested) {
      const trimmed = t?.trim()
      if (trimmed) variantSet.add(trimmed)
    }
    // MU search NÃO devolve `associated[]` — só o detail endpoint. Marca o ID
    // pra enriquecer abaixo via fetch dedicado.
    if (source === "mangaupdates") {
      const idPart = top.r.id.split(":")[1]
      const n = Number(idPart)
      if (Number.isFinite(n)) muTopId = n
    }
  }

  // Enriquece variantes com o `associated[]` do MU detail quando temos o ID.
  // Crucial pra casos como "I Won't Be the Villain's Only Lover" → ComicK só
  // indexa essa obra como "What Caused This to Happen...?!", título que só
  // aparece nessa lista.
  let muAltsFetched: string[] = []
  if (muTopId != null) {
    muAltsFetched = await fetchMangaUpdatesAlternativeTitles(muTopId)
    for (const t of muAltsFetched) {
      const trimmed = t?.trim()
      if (trimmed) variantSet.add(trimmed)
    }
  }
  // Variantes pra retry = tudo que sobrou depois de remover a query primária.
  const variants = [...variantSet]
    .filter((v) => v !== primaryQuery)
    .slice(0, MAX_RETRY_VARIANTS)

  console.log(
    `[revalidateWorkSources] workId=${workId} primary="${primaryQuery}" ` +
    `muTopId=${muTopId} muAltsFetched=[${muAltsFetched.join(" | ")}] ` +
    `variants=[${variants.join(" | ")}]`
  )

  const allVariants = [primaryQuery, ...variants]
  const scoreResult = (result: ExternalSearchResult) => ({
    result,
    matchScore: scoreAgainst(allVariants, result),
  })

  // Pass 2: retry com variantes enriquecidas (MU detail + alt titles do work).
  // Otimizações:
  //   - Pula fontes onde algum título do resultado existente bate EXATO com
  //     alguma variante conhecida (skip inteligente — agora funciona porque
  //     variantes incluem associated names do MU detail).
  //   - Strip de pontuação só pras fontes strict-tokenize (ComicK, Kitsu).
  //     Outras APIs casam com pontuação sem problema.
  const stripPunct = (s: string) =>
    s.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
  const STRICT_TOKENIZE: ReadonlySet<ExternalSourceId> = new Set(["comick", "kitsu"])
  const normalizeForKey = (s: string) =>
    s.toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  const variantKeys = new Set(
    [primaryQuery, ...variants].map(normalizeForKey).filter(Boolean)
  )
  const dedupVariants = (list: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of list) {
      const t = v.trim()
      if (!t || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      out.push(t)
    }
    return out
  }
  const variantsForSource = (source: ExternalSourceId): string[] =>
    STRICT_TOKENIZE.has(source)
      ? dedupVariants([...variants, ...variants.map(stripPunct)])
      : variants

  if (variants.length > 0) {
    const connectorsToTry = SEARCH_CONNECTORS.filter((c) => {
      const raw = rawBySource.get(c.source) ?? []
      if (raw.length === 0) return true
      return !raw.some((r) => {
        const titles = [r.title, r.originalTitle, ...(r.alternativeTitles ?? [])]
        return titles.some((t) => t && variantKeys.has(normalizeForKey(t)))
      })
    })

    await Promise.all(connectorsToTry.map(async (connector) => {
      const queries = variantsForSource(connector.source)
      const settled = await Promise.allSettled(queries.map((v) => connector.search(v)))
      const extras = settled.flatMap((entry, i) => {
        if (entry.status === "fulfilled") return entry.value
        console.error(
          `[revalidateWorkSources] retry connector=${connector.source} variant="${queries[i]}" failed`,
          entry.reason instanceof Error ? entry.reason.message : entry.reason
        )
        return []
      })
      const existing = rawBySource.get(connector.source) ?? []
      const merged = [...existing]
      const seen = new Set(existing.map((r) => r.id))
      let added = 0
      for (const r of extras) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        merged.push(r)
        added += 1
      }
      if (added > 0) rawBySource.set(connector.source, merged)
      if (extras.length > 0 || added > 0) {
        console.log(
          `[revalidateWorkSources] retry source=${connector.source}: ${extras.length} raw, +${added} new`
        )
      }
    }))
  }

  const candidatesPerSource: Partial<Record<ExternalSourceId, SourceCandidateOption[]>> = {}
  for (const [source, results] of rawBySource) {
    const scored = results
      .map(scoreResult)
      .filter(({ matchScore }) => matchScore >= KEEP_MATCH)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3)
    if (scored.length === 0) continue
    candidatesPerSource[source] = scored.map(({ result, matchScore }) => {
      let coverUrl = result.coverUrl ?? null
      if (isBlockedCoverUrl(coverUrl)) {
        coverUrl = resolveCrossSourceCover(result, rawBySource)
      }
      return {
        externalId: result.id.split(":")[1] ?? result.id,
        title: result.title,
        coverUrl,
        matchScore,
        synopsis: result.synopsis ?? null,
        year: result.year ?? null,
        chapters: result.chapters ?? null,
      }
    })
  }

  // AnimePlanet é frequentemente bloqueado por Cloudflare em server-side fetch.
  // Na revalidação o usuário já está conferindo manualmente, então mostramos um
  // candidato de slug canônico quando a busca HTML não conseguiu retornar cards.
  addAnimePlanetFallbackCandidate(
    candidatesPerSource,
    queries,
    pickPrimaryCover(work.work_covers)
  )

  for (const [source, opts] of Object.entries(candidatesPerSource)) {
    console.log(
      `[revalidateWorkSources] final candidatesPerSource.${source}: [${(opts ?? []).map((c) => `${c.title} (${(c.matchScore * 100).toFixed(0)}%)`).join(" | ")}]`
    )
  }

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
