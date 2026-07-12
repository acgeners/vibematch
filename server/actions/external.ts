"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { TAG_GROUP_LABELS, type TagGroupSlug } from "@/lib/constants/tag-groups"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG, normalizeTagGroupSlug } from "@/lib/constants/tag-groups-utils"
import { TAG_GROUPS_CATALOG, GENRE_NAMES } from "@/lib/constants/tags"
import { searchAllSourcesWithStatus, fetchMultiSourceDetails, fetchExternalEvaluationContextForWork, fetchExternalEvaluationContextForCandidate, buildCandidateFromExternalIds, SEARCH_CONNECTORS, bestTitleMatch } from "@/lib/external/index"
import type { SearchAllSourcesResult } from "@/lib/external/index"
import { fetchMangaUpdatesAlternativeTitles } from "@/lib/external/mangaupdates"
import { fetchComixById } from "@/lib/external/comix"
import { fetchMangagoById } from "@/lib/external/mangago"
import { resolveComixUrl, comixCreateResolveInput } from "@/lib/external/comix-resolve"
import { isComixRenderConfigured } from "@/lib/external/comix-render-client"
import { resolveMangagoUrlProd } from "@/lib/external/mangago-resolve-prod"
import { boolEnv } from "@/lib/external/mangago-band"
import { AI_EVAL_REVIEW_CAPS, requestAiEvaluation, type AiEvaluationTag } from "@/lib/ai-evaluation/service"
import { SONNET_MODEL } from "@/lib/ai/models"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { getSourcesHealth } from "@/lib/external/source-health-store"
import type { ExternalSourceId, MergedCandidate, TagSuggestion, ExternalWorkData, ConflictField, SourcedReview, ExternalSearchResult, SourceHealthRow } from "@/lib/external/types"
import type { CriterionSlug } from "@/types/domain"
import { revalidatePath } from "next/cache"
import { pickPrimaryCover } from "@/lib/work-derived"
import { isBlockedCoverUrl } from "@/lib/external/blocked-covers"
import { ensureAdmin } from "@/server/queries/current-user"

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

export async function searchExternalTitles(query: string): Promise<SearchAllSourcesResult> {
  return searchAllSourcesWithStatus(query)
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

// Pre-creates external tags through the shared ingestion pipeline: resolves
// aliases/existing, creates missing (catalog group fast-path) and schedules
// background classification (group via AI when needed + sub-group + cluster).
export async function upsertExternalTags(tagNames: string[]): Promise<void> {
  if (!tagNames.length) return
  const supabase = createAdminClient()
  const { createdIds } = await resolveOrCreateTags(supabase, tagNames)
  scheduleTagEnrichment(createdIds)
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
  /** true quando o hid da Comix foi descoberto automaticamente por cross-ID nesta
   *  avaliação (sidecar). O client usa pra dar feedback de sucesso ao usuário. */
  comixAutoResolved: boolean
}

/** Retorno do gate pré-análise quando a obra não tem reviews externas e o
 * cliente ainda não confirmou seguir mesmo assim. */
export interface CandidateAiNeedsReviewConfirmation {
  needsReviewConfirmation: true
  noReviewsReason: CandidateAiResult["noReviewsReason"]
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
const CREATE_FLOW_SONNET_ID = SONNET_MODEL

/**
 * Resolve o hid da Comix por cross-ID via sidecar, pra usar JÁ na avaliação de
 * criação (a Comix não aparece na busca multi-fonte porque é token-gated). Cache-
 * first e fail-soft: sem `COMIX_RENDER_URL` ou sem cross-ID → null (no-op) e a
 * Comix segue ausente; nunca lança. Só cross-ID exato (não arrisca match por
 * título). A persistência do hid roda depois, no `after()` do `createWork`.
 */
async function resolveComixHidForCreate(
  title: string,
  externalIds: Partial<Record<ExternalSourceId, string>>,
): Promise<string | null> {
  if (!isComixRenderConfigured()) return null
  const request = comixCreateResolveInput(title, externalIds)
  if (!request) return null
  try {
    const resolved = await resolveComixUrl(request)
    return resolved?.hid ?? null
  } catch (err) {
    console.error("[resolveComixHidForCreate] falha:", err instanceof Error ? err.message : err)
    return null
  }
}

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
  /**
   * Quando true, segue com a avaliação mesmo sem reviews externas. Sem isso, o
   * gate pré-análise retorna `needsReviewConfirmation` antes de chamar o LLM
   * para o cliente confirmar.
   */
  proceedWithoutReviews?: boolean
}): Promise<CandidateAiResult | CandidateAiNeedsReviewConfirmation> {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  // Descoberta do hid da Comix no create (sidecar): a Comix não entra na busca
  // multi-fonte (token-gated), então sem isto a avaliação de criação NUNCA usa
  // reviews da Comix. Resolve por cross-ID e injeta o hid pra o caminho candidate
  // coletar as reviews da Comix já nesta avaliação. No-op sem sidecar/cross-ID.
  const externalIds: Partial<Record<ExternalSourceId, string>> = { ...(input.externalIds ?? {}) }
  const resolvedComixHid = await resolveComixHidForCreate(input.title, externalIds)
  if (resolvedComixHid) externalIds.comix = resolvedComixHid

  const externalIdEntries = Object.entries(externalIds).filter(([, id]) => Boolean(id))
  const hasExternalIds = externalIdEntries.length > 0
  const contextResult = hasExternalIds
    ? await fetchExternalEvaluationContextForCandidate(
        buildCandidateFromExternalIds({
          title: input.title,
          originalTitle: input.originalTitle ?? null,
          alternativeTitles: input.alternativeTitles ?? null,
        }, externalIds),
        { ...AI_EVAL_REVIEW_CAPS }
      )
    : await fetchExternalEvaluationContextForWork({
        title: input.title,
        originalTitle: input.originalTitle ?? null,
        alternativeTitles: input.alternativeTitles ?? null,
      })
  const externalContext = input.externalContext ?? contextResult.externalContext

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

  // Gate pré-análise: sem reviews externas, deixa o cliente decidir se segue
  // mesmo assim antes de gastar a chamada do LLM.
  if ((contextResult.sourcedReviews?.length ?? 0) === 0 && !input.proceedWithoutReviews) {
    return { needsReviewConfirmation: true, noReviewsReason }
  }

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
    contentRatings: contextResult.contentRatings,
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
    comixAutoResolved: Boolean(resolvedComixHid),
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
  /**
   * A fonte tem vínculo salvo, mas o detalhe dela não pôde ser lido agora (ex.:
   * FlareSolverr fora / circuito aberto). Neste caso o candidato NÃO descreve a
   * fonte: título e capa vêm da própria obra e `matchScore` não é um match de
   * título. A UI precisa da flag pra não vender uma queda de infra como
   * "match 100%" — ver o branch de falha em `ensureGatedCandidate`.
   */
  detailUnavailable?: boolean
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
  /**
   * Saúde observada por fonte (`external_source_health`). Sem isto, "a fonte está
   * fora" e "a obra não existe nessa fonte" chegam na UI como a MESMA coisa — zero
   * candidato — e o usuário rejeita a fonte por causa de uma queda passageira.
   */
  sourceHealth: Record<string, SourceHealthRow>
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

// Chave canônica `source:externalId`. Usa `r.source` (ExternalSourceId) em vez
// do prefixo do `r.id` — eles divergem (id "mal:789"/"mu:456" vs source
// "myanimelist"/"mangaupdates"), e os crossIds usam o ExternalSourceId. Sem essa
// normalização o empréstimo de cover nunca casava pra MyAnimeList/MangaUpdates.
function canonicalKey(source: ExternalSourceId, id: string): string {
  const externalId = id.includes(":") ? id.split(":").slice(1).join(":") : id
  return `${source}:${externalId}`
}

interface CoverBorrowIndex {
  coverByKey: Map<string, string>
  adjacency: Map<string, Set<string>>
}

// Constrói um grafo de cross-links entre TODOS os resultados crus (bidirecional)
// e um pool de covers utilizáveis (não-bloqueadas) por chave canônica. Permite
// que uma fonte com cover bloqueada (ex.: Comix/Cloudflare) ou ausente "tome
// emprestada" a cover de qualquer obra cross-referenciada — inclusive por links
// reversos e transitivos. Tudo em memória, sem chamadas externas extras.
function buildCoverBorrowIndex(
  rawBySource: Map<ExternalSourceId, ExternalSearchResult[]>
): CoverBorrowIndex {
  const coverByKey = new Map<string, string>()
  const adjacency = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (a === b) return
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }
  for (const [source, results] of rawBySource) {
    for (const r of results) {
      const key = canonicalKey(source, r.id)
      if (r.coverUrl && !isBlockedCoverUrl(r.coverUrl) && !coverByKey.has(key)) {
        coverByKey.set(key, r.coverUrl)
      }
      for (const [altSource, altId] of Object.entries(r.crossIds ?? {})) {
        if (altId) addEdge(key, `${altSource}:${altId}`)
      }
    }
  }
  return { coverByKey, adjacency }
}

// BFS pelo grafo de cross-links (vizinhos diretos primeiro) buscando a primeira
// cover utilizável conectada à chave da obra.
function borrowCover(key: string, index: CoverBorrowIndex): string | null {
  const seen = new Set<string>([key])
  const queue = [key]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const cover = index.coverByKey.get(cur)
    if (cover) return cover
    for (const next of index.adjacency.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return null
}

/**
 * Busca candidatos por fonte pra UI de revalidação. Top 3 por fonte com
 * matchScore ≥ 0.65 (mesmo limiar inicial do mergeSearchResults). Marca
 * as seleções atuais via work_external_ids.
 */
export async function revalidateWorkSources(workId: string): Promise<{ data?: RevalidateSourcesResult; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
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

  const coverBorrowIndex = buildCoverBorrowIndex(rawBySource)
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
      // Cover ausente ou bloqueada (Cloudflare): tenta emprestar de uma obra
      // cross-referenciada em outra fonte com CDN aberto.
      if (!coverUrl || isBlockedCoverUrl(coverUrl)) {
        const borrowed = borrowCover(canonicalKey(source, result.id), coverBorrowIndex)
        coverUrl = borrowed ?? (isBlockedCoverUrl(coverUrl) ? null : coverUrl)
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

  // Comix + Mangago: a busca deles é gateada (token / flag), então não vêm em
  // candidatesPerSource. Garante um candidato: usa o id salvo (não-rejeitado) ou,
  // se não houver, resolve por cross-ID (sidecar Comix / resolver Mangago, cada um
  // atrás do seu gate). Sem isso a fonte vinculada fica invisível no dialog e não há
  // como trazê-la sem hid manual. Fail-soft: qualquer erro → fonte fica ausente.
  const acceptedIds: Partial<Record<string, string>> = {}
  for (const s of currentSelections) {
    if (!s.isRejected && s.externalId) acceptedIds[s.source] = s.externalId
  }
  const posInt = (v?: string) => {
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  const crossInput = {
    title: primaryQuery,
    anilistId: posInt(acceptedIds.anilist),
    malId: posInt(acceptedIds.myanimelist),
    mangaUpdatesId: acceptedIds.mangaupdates || undefined,
  }
  const hasCrossId = Boolean(crossInput.anilistId || crossInput.malId || crossInput.mangaUpdatesId)

  const ensureGatedCandidate = async (opts: {
    source: ExternalSourceId
    resolveEnabled: boolean
    resolve: () => Promise<string | null>
    fetchDetail: (id: string) => Promise<{ title?: string; coverUrl?: string; synopsis?: string; year?: number; chapters?: number } | null>
  }): Promise<void> => {
    if (currentSelections.some((s) => s.source === opts.source && s.isRejected)) return
    const savedId = acceptedIds[opts.source] ?? null
    let id = savedId
    if (!id && opts.resolveEnabled) id = await opts.resolve().catch(() => null)
    if (!id) return
    const existing = candidatesPerSource[opts.source] ?? []
    if (existing.some((c) => c.externalId === id)) return
    const detail = await opts.fetchDetail(id).catch(() => null)
    if (!detail?.title) {
      // Detalhe falhou (ex.: FlareSolverr fora). Se o id JÁ está vinculado (veio do
      // salvo/aceito), NÃO some com ele: mostra um candidato PRÉ-MARCADO pra o
      // vínculo sobreviver ao "Atualizar dados" mesmo com a fonte fora do ar. Só quando
      // o id foi resolvido agora (ainda não vinculado) é que descarta — nada a perder.
      //
      // O candidato empresta título e capa DA PRÓPRIA OBRA e vai marcado com
      // `detailUnavailable`. Antes ele saía com `coverUrl: null`, e o card virava um
      // placeholder quebrado, sem ano, com um "match 100%" de aparência confiável —
      // ou seja, uma queda passageira de infra era VISUALMENTE IDÊNTICA a "essa fonte
      // não tem capa". A flag é o que deixa a UI dizer que o dado não veio da fonte.
      if (id === savedId) {
        candidatesPerSource[opts.source] = [
          {
            externalId: id,
            title: work.title,
            coverUrl: pickPrimaryCover(work.work_covers),
            matchScore: 1,
            synopsis: null,
            year: null,
            chapters: null,
            detailUnavailable: true,
          },
          ...existing,
        ]
      }
      return
    }
    const coverUrl = detail.coverUrl && !isBlockedCoverUrl(detail.coverUrl) ? detail.coverUrl : null
    candidatesPerSource[opts.source] = [
      {
        externalId: id,
        title: detail.title,
        coverUrl,
        matchScore: 1,
        synopsis: detail.synopsis ?? null,
        year: detail.year ?? null,
        chapters: detail.chapters ?? null,
      },
      ...existing,
    ]
  }

  await Promise.all([
    ensureGatedCandidate({
      source: "comix",
      resolveEnabled: hasCrossId && isComixRenderConfigured(),
      resolve: async () => (await resolveComixUrl({ ...crossInput, allowTitleFallback: false }))?.hid ?? null,
      fetchDetail: (id) => fetchComixById(id),
    }),
    ensureGatedCandidate({
      source: "mangago",
      resolveEnabled: hasCrossId && boolEnv(process.env.MANGAGO_RESOLVE_ENABLED, false),
      resolve: async () => (await resolveMangagoUrlProd(crossInput))?.slug ?? null,
      // Caminho interativo: o usuário está parado na seleção de fontes, então vale uma
      // 2ª tentativa curta antes de degradar o card (ver `fetchMangagoById`).
      fetchDetail: (id) => fetchMangagoById(id, { retry: true }),
    }),
  ])

  return {
    data: {
      query: primaryQuery,
      candidatesPerSource,
      currentSelections,
      sourceHealth: await getSourcesHealth(),
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
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()

  const rowsToUpsert = selections.map((s) => ({
    work_id: workId,
    source: s.source,
    external_id: s.externalId,
    is_rejected: s.isRejected,
  }))

  // Sources presentes no payload → upsert. Sources AUSENTES ("Não decidir agora"):
  // só apaga se NÃO for um vínculo aceito válido. Um id já aceito ausente do payload
  // significa "deixa como está", NUNCA "apaga" — senão um tropeço transiente da fonte
  // (ex.: FlareSolverr fora, que fez o card nem aparecer no diálogo) destruiria um hid
  // válido. Pra remover de fato, o usuário marca "ignorar" (rejeitado) — que é explícito.
  const presentSources = new Set(selections.map((s) => s.source))
  const { data: existing } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", workId)
  const toDelete = (existing ?? [])
    .filter((r) => !presentSources.has(r.source as ExternalSourceId))
    .filter((r) => !(r.external_id && r.is_rejected !== true)) // preserva vínculo aceito
    .map((r) => r.source as ExternalSourceId)

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
