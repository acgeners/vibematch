import { createAdminClient } from "@/lib/supabase/admin"
import { unstable_cache } from "next/cache"
import type {
  WorkWithRelations,
  WorkFilters,
  WorkSort,
  PaginatedResult,
} from "@/types/domain"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
} from "@/lib/constants/status-lookups"
import { titleToSlug } from "@/lib/utils"

const WORK_WITH_RELATIONS_SELECT = `
  *,
  category_scores(*),
  platform_ratings(*),
  calculated_scores(*),
  work_tags(tag_id, source, confidence, tags(*)),
  work_genres(genre_id, genres(id, name, slug)),
  work_covers(id, url, source, is_primary, position),
  work_synopses(id, source, text, is_primary, position)
`

const WORK_LIST_SELECT = `
  id,
  title,
  original_title,
  alternative_titles,
  publication_status_id,
  personal_status_id,
  ai_eval_status,
  chapters_read,
  total_chapters,
  is_archived,
  is_favorite,
  year,
  synopsis_quality,
  created_at,
  updated_at,
  last_read_at,
  calculated_scores(calc_score, expected_score, expected_baseline, expected_quality_adj, expected_is_stub, chance_score, chance_is_stub, personal_fit, personal_fit_percentile, alignment_score, alignment_justification, alignment_payload, alignment_stale, alignment_at, platform_avg, total_votes),
  category_scores(criterion_slug, score),
  work_covers(url, is_primary, position),
  work_tags(tag_id, tags(*)),
  work_genres(genre_id, genres(id, name, slug))
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFilterableQuery = any

function normalizeTitleSearchMatch(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

function workMatchesSearchTerm(
  work: { title: string | null; original_title: string | null; alternative_titles: string[] | null },
  searchTerm: string,
) {
  const normalizedSearch = normalizeTitleSearchMatch(searchTerm)
  if (!normalizedSearch) return false

  return [
    work.title,
    work.original_title,
    ...(work.alternative_titles ?? []),
  ].some((name) => normalizeTitleSearchMatch(name).includes(normalizedSearch))
}

// Supabase/PostgREST does not support a simple ilike over text[] values, so
// resolve title-search matches to IDs first and keep pagination/counts coherent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSearchMatchIds(supabase: any, searchTerm: string | undefined): Promise<string[] | null> {
  if (!searchTerm) return null
  const escaped = searchTerm.replace(/[%,]/g, " ").trim()
  if (!escaped) return null

  const { data, error } = await supabase
    .from("works")
    .select("id, title, original_title, alternative_titles")
    .limit(1000)

  if (error) throw new Error(error.message)

  return (data ?? [])
    .filter((work: { title: string | null; original_title: string | null; alternative_titles: string[] | null }) =>
      workMatchesSearchTerm(work, escaped),
    )
    .map((work: { id: string }) => work.id)
}

/**
 * Resolve uma lista de títulos digitados (ex.: pelo chat) para obras do catálogo,
 * de forma determinística (sem LLM). Para cada título retorna:
 *  - `matched`   → 1 obra encontrada (melhor faixa de match)
 *  - `ambiguous` → várias obras na melhor faixa (o caller pede pra desambiguar)
 *  - `not_found` → nenhuma correspondência
 *
 * Ranqueia por faixa: igualdade exata > começa-com > contém (em qualquer um de
 * title/original_title/alternative_titles, normalizados). Reusa a mesma
 * normalização da busca por título da listagem.
 */
export type TitleResolution =
  | { query: string; status: "matched"; work: { id: string; title: string } }
  | { query: string; status: "ambiguous"; options: Array<{ id: string; title: string }> }
  | { query: string; status: "not_found" }

const MAX_AMBIGUOUS_OPTIONS = 6

function titleMatchTier(
  work: { title: string | null; original_title: string | null; alternative_titles: string[] | null },
  normalizedQuery: string,
): 0 | 1 | 2 | 3 {
  const names = [work.title, work.original_title, ...(work.alternative_titles ?? [])]
    .map(normalizeTitleSearchMatch)
    .filter(Boolean)
  let best: 0 | 1 | 2 | 3 = 0
  for (const name of names) {
    if (name === normalizedQuery) return 3
    if (name.startsWith(normalizedQuery)) best = best < 2 ? 2 : best
    else if (name.includes(normalizedQuery) || normalizedQuery.includes(name))
      best = best < 1 ? 1 : best
  }
  return best
}

export async function resolveWorksByTitles(titles: string[]): Promise<TitleResolution[]> {
  const queries = titles.map((t) => t.trim()).filter(Boolean)
  if (queries.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, title, original_title, alternative_titles")
    .eq("is_archived", false)
    .limit(5000)
  if (error) throw new Error(`Falha resolvendo títulos: ${error.message}`)
  const works = (data ?? []) as Array<{
    id: string
    title: string | null
    original_title: string | null
    alternative_titles: string[] | null
  }>

  return queries.map((query) => {
    const normalizedQuery = normalizeTitleSearchMatch(query)
    let bestTier: 0 | 1 | 2 | 3 = 0
    let bucket: Array<{ id: string; title: string }> = []
    for (const w of works) {
      const tier = titleMatchTier(w, normalizedQuery)
      if (tier === 0) continue
      if (tier > bestTier) {
        bestTier = tier
        bucket = [{ id: w.id, title: w.title ?? "(sem título)" }]
      } else if (tier === bestTier) {
        bucket.push({ id: w.id, title: w.title ?? "(sem título)" })
      }
    }
    if (bestTier === 0 || bucket.length === 0) return { query, status: "not_found" as const }
    if (bucket.length === 1) return { query, status: "matched" as const, work: bucket[0] }
    return { query, status: "ambiguous" as const, options: bucket.slice(0, MAX_AMBIGUOUS_OPTIONS) }
  })
}

function applyWorkFilters(
  query: SupabaseFilterableQuery,
  filters: WorkFilters,
  searchMatchIds: string[] | null,
  genreMatchIds: string[] | null,
  tagMatchIds: string[] | null,
): SupabaseFilterableQuery {
  if (filters.publicationStatus?.length) {
    const ids = filters.publicationStatus
      .map(getPublicationStatusIdByName)
      .filter((id): id is number => id != null)
    if (ids.length > 0) query = query.in("publication_status_id", ids)
  }
  if (filters.personalStatus?.length) {
    const ids = filters.personalStatus
      .map(getPersonalStatusIdByName)
      .filter((id): id is number => id != null)
    if (ids.length > 0) query = query.in("personal_status_id", ids)
  }
  if (filters.aiEvalStatus?.length) {
    query = query.in("ai_eval_status", filters.aiEvalStatus)
  }
  if (filters.minChapters != null) {
    query = query.gte("total_chapters", filters.minChapters)
  }
  if (filters.maxChapters != null) {
    query = query.lte("total_chapters", filters.maxChapters)
  }
  if (filters.year != null) {
    query = query.eq("year", filters.year)
  }
  if (genreMatchIds) {
    query = query.in("id", genreMatchIds.length ? genreMatchIds : ["00000000-0000-0000-0000-000000000000"])
  }
  if (tagMatchIds) {
    query = query.in("id", tagMatchIds.length ? tagMatchIds : ["00000000-0000-0000-0000-000000000000"])
  }
  if (filters.isArchived !== undefined) {
    query = query.eq("is_archived", filters.isArchived)
  } else {
    query = query.eq("is_archived", false)
  }
  if (filters.isFavorite) {
    query = query.eq("is_favorite", true)
  }
  if (searchMatchIds) {
    query = query.in("id", searchMatchIds.length ? searchMatchIds : ["00000000-0000-0000-0000-000000000000"])
  }
  return query
}

export async function getWorks(
  filters: WorkFilters = {},
  sort: WorkSort = { field: "expected_score", direction: "desc" },
  page = 1,
  pageSize = 50
): Promise<PaginatedResult<WorkWithRelations>> {
  const supabase = createAdminClient()
  const searchTerm = filters.search?.trim() || undefined
  const needsClientScoreProcessing =
    sort.field === "expected_score" ||
    sort.field === "is_favorite" ||
    filters.minExpectedScore != null ||
    filters.maxExpectedScore != null ||
    filters.minPersonalFitPct != null ||
    filters.maxPersonalFitPct != null ||
    filters.minTotalVotes != null ||
    filters.maxTotalVotes != null

  // Resolve text/genre/tag ID filters in parallel, then apply them before paging.
  const [searchMatchIds, genreMatchIds, tagMatchIds] = await Promise.all([
    getSearchMatchIds(supabase, searchTerm),
    filters.genres?.length
      ? supabase
          .from("work_genres")
          .select("work_id, genres!inner(name)")
          .in("genres.name", filters.genres)
          .then(({ data }) => [...new Set((data ?? []).map((row) => row.work_id))])
      : Promise.resolve(null),
    filters.tagSlugs?.length
      ? supabase
          .from("work_tags")
          .select("work_id, tags!inner(slug)")
          .in("tags.slug", filters.tagSlugs)
          .then(({ data }) => {
            const countByWork: Record<string, number> = {}
            for (const r of data ?? []) {
              countByWork[r.work_id] = (countByWork[r.work_id] ?? 0) + 1
            }
            return Object.entries(countByWork)
              .filter(([, c]) => c >= filters.tagSlugs!.length)
              .map(([id]) => id)
          })
      : Promise.resolve(null),
  ])

  const from = (page - 1) * pageSize

  if (needsClientScoreProcessing) {
    // Two-phase: lightweight fetch to filter+sort by score, then heavy fetch for the
    // page IDs only. Avoids loading WORK_LIST_SELECT (with joined work_tags) for
    // every matching work just to throw most of it away.
    let lightQuery = supabase
      .from("works")
      .select("id, is_favorite, calculated_scores(expected_score, personal_fit, personal_fit_percentile, total_votes)")
    lightQuery = applyWorkFilters(lightQuery, filters, searchMatchIds, genreMatchIds, tagMatchIds)

    const { data: lightData, error: lightError } = await lightQuery
    if (lightError) throw new Error(lightError.message)

    type LightRow = {
      id: string
      is_favorite: boolean
      calculated_scores: {
        expected_score: number | null
        personal_fit: number | null
        personal_fit_percentile: number | null
        total_votes: number | null
      } | null
    }

    let scored = (lightData ?? []).map((row): LightRow => {
      const cs = (row as { calculated_scores: unknown }).calculated_scores
      const flat = Array.isArray(cs) ? (cs[0] ?? null) : (cs ?? null)
      return {
        id: (row as { id: string }).id,
        is_favorite: Boolean((row as { is_favorite?: boolean }).is_favorite),
        calculated_scores: flat as LightRow["calculated_scores"],
      }
    })

    if (filters.minExpectedScore != null) {
      scored = scored.filter((w) => (w.calculated_scores?.expected_score ?? -1) >= filters.minExpectedScore!)
    }
    if (filters.maxExpectedScore != null) {
      scored = scored.filter((w) => (w.calculated_scores?.expected_score ?? 11) <= filters.maxExpectedScore!)
    }
    // Alinhamento filtrado pelo percentil exibido (fallback: raw × 100, como na célula).
    const fitPct = (cs: LightRow["calculated_scores"]): number | null =>
      cs?.personal_fit_percentile != null
        ? cs.personal_fit_percentile
        : cs?.personal_fit != null
          ? cs.personal_fit * 100
          : null
    if (filters.minPersonalFitPct != null) {
      scored = scored.filter((w) => {
        const p = fitPct(w.calculated_scores)
        return p != null && p >= filters.minPersonalFitPct!
      })
    }
    if (filters.maxPersonalFitPct != null) {
      scored = scored.filter((w) => {
        const p = fitPct(w.calculated_scores)
        return p != null && p <= filters.maxPersonalFitPct!
      })
    }
    if (filters.minTotalVotes != null) {
      scored = scored.filter((w) => (w.calculated_scores?.total_votes ?? 0) >= filters.minTotalVotes!)
    }
    if (filters.maxTotalVotes != null) {
      scored = scored.filter((w) => (w.calculated_scores?.total_votes ?? 0) <= filters.maxTotalVotes!)
    }

    if (sort.field === "is_favorite") {
      // Favoritos primeiro (ou último, se asc); desempate por Nota Prevista desc.
      scored.sort((a, b) => {
        const favDelta = Number(b.is_favorite) - Number(a.is_favorite)
        if (favDelta !== 0) return sort.direction === "asc" ? -favDelta : favDelta
        const aScore = a.calculated_scores?.expected_score ?? -1
        const bScore = b.calculated_scores?.expected_score ?? -1
        return bScore - aScore
      })
    } else {
      // Único sort de nota restante: Nota Prevista (expected_score).
      scored.sort((a, b) => {
        const aScore = a.calculated_scores?.expected_score ?? -1
        const bScore = b.calculated_scores?.expected_score ?? -1
        return sort.direction === "desc" ? bScore - aScore : aScore - bScore
      })
    }

    const total = scored.length
    const pageIds = scored.slice(from, from + pageSize).map((w) => w.id)

    if (pageIds.length === 0) {
      return { data: [], total, page, pageSize }
    }

    const { data: heavyData, error: heavyError } = await supabase
      .from("works")
      .select(WORK_LIST_SELECT)
      .in("id", pageIds)

    if (heavyError) throw new Error(heavyError.message)

    const orderMap = new Map(pageIds.map((id, i) => [id, i]))
    const works = (heavyData ?? [])
      .slice()
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
      .map(normalizeWorkRelations)

    return { data: works, total, page, pageSize }
  }

  // Server-side pagination path (sort by indexable column).
  let query = supabase
    .from("works")
    .select(WORK_LIST_SELECT, { count: "exact" })
  query = applyWorkFilters(query, filters, searchMatchIds, genreMatchIds, tagMatchIds)

  if (sort.field === "title") {
    query = query.order("title", { ascending: sort.direction === "asc" })
  } else {
    query = query.order(sort.field, { ascending: sort.direction === "asc" })
  }

  query = query.range(from, from + pageSize - 1)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)

  return {
    data: (data ?? []).map(normalizeWorkRelations),
    total: count ?? 0,
    page,
    pageSize,
  }
}

export async function getWorkById(id: string): Promise<WorkWithRelations | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("works")
    .select(WORK_WITH_RELATIONS_SELECT)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return normalizeWorkRelations(data)
}

// Map of slug -> work id, cached so navigating to a work by slug doesn't refetch
// the entire works table on every click. Invalidated by revalidateTag("works-slug-index")
// from server actions that mutate the works table.
const getSlugToIdMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("works")
      .select("id, title")
    const map: Record<string, string> = {}
    for (const row of data ?? []) {
      const slug = titleToSlug(row.title ?? "")
      if (slug && !map[slug]) map[slug] = row.id
    }
    return map
  },
  ["works-slug-index-v1"],
  { revalidate: 300, tags: ["works-slug-index"] },
)

export async function getWorkBySlug(slug: string) {
  const map = await getSlugToIdMap()
  let id = map[slug]
  if (!id) {
    // O índice slug→id é cacheado e a invalidação por tag pode não propagar
    // a tempo da navegação após criar uma obra. Fallback: consulta direta no
    // banco para evitar 404 em obras recém-criadas.
    const supabase = createAdminClient()
    const { data } = await supabase.from("works").select("id, title")
    id = (data ?? []).find((row) => titleToSlug(row.title ?? "") === slug)?.id
  }
  if (!id) return null
  return getWorkWithAiEvaluations(id)
}

/**
 * IDs externos ACEITOS de uma obra (`work_external_ids`, exceto rejeitados),
 * como mapa `{ source: external_id }`. Usado na edição pra exibir/manter vínculos
 * já atribuídos (ex.: o hid da Comix) no passo de seleção de fontes.
 */
export async function getWorkExternalIds(workId: string): Promise<Record<string, string>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", workId)
  if (error) {
    console.error("[getWorkExternalIds] failed:", error.message)
    return {}
  }
  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row.is_rejected !== true && row.external_id) {
      map[row.source as string] = String(row.external_id)
    }
  }
  return map
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Busca só o título de uma obra por id (UUID) ou slug. Usado pelo
 * `generateMetadata` da página de detalhe pra nomear a aba do navegador sem
 * carregar todas as relações da obra.
 */
export async function getWorkTitleByIdOrSlug(idOrSlug: string): Promise<string | null> {
  const supabase = createAdminClient()
  if (UUID_RE.test(idOrSlug)) {
    const { data } = await supabase
      .from("works")
      .select("title")
      .eq("id", idOrSlug)
      .maybeSingle()
    return (data?.title as string | null) ?? null
  }
  const { data } = await supabase.from("works").select("title")
  return (
    (data ?? []).find((row) => titleToSlug(row.title ?? "") === idOrSlug)?.title ?? null
  )
}

export async function getWorkIdsBySlug(slug: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, title")

  if (error) throw new Error(error.message)

  return (data ?? [])
    .filter((row) => titleToSlug(row.title ?? "") === slug)
    .map((row) => row.id as string)
}

export async function getWorkWithAiEvaluations(id: string) {
  const supabase = createAdminClient()

  const [workResult, evaluationResult] = await Promise.all([
    supabase
      .from("works")
      .select(WORK_WITH_RELATIONS_SELECT)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("ai_evaluations")
      .select(`
        id,
        work_id,
        status,
        model_name,
        prompt_version,
        summary,
        confidence,
        raw_response,
        created_at,
        updated_at,
        ai_evaluation_scores(
          id,
          ai_evaluation_id,
          criterion_slug,
          suggested_score,
          justification,
          accepted_score,
          was_accepted,
          was_edited
        )
      `)
      .eq("work_id", id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const { data, error } = workResult

  if (error) throw new Error(error.message)
  if (!data) return null
  if (evaluationResult.error) throw new Error(evaluationResult.error.message)

  return {
    ...normalizeWorkRelations(data),
    ai_evaluations: evaluationResult.data ? [evaluationResult.data] : [],
  }
}

export async function getWorksByIds(ids: string[]): Promise<WorkWithRelations[]> {
  if (ids.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(WORK_WITH_RELATIONS_SELECT)
    .in("id", ids)

  if (error) throw new Error(error.message)

  const byId = new Map(((data ?? []) as Array<{ id: string }>).map((row) => [row.id, row]))
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map(normalizeWorkRelations)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeWorkRelations(data: any): WorkWithRelations {
  // Preserva a proveniência da linha work_tags (source/confidence) junto de cada
  // tag — usado na página da obra pra distinguir externa/manual de ai_inferred.
  const tags = (data.work_tags ?? [])
    .filter((wt: { tags: unknown }) => Boolean(wt.tags))
    .map((wt: { tags: Record<string, unknown>; source?: string | null; confidence?: number | null }) => ({
      ...wt.tags,
      source: wt.source ?? null,
      confidence: wt.confidence ?? null,
    })) as Array<{ name?: string; tag_group_id?: string | null; source?: string | null; confidence?: number | null }>
  const genres = ((data.work_genres ?? []) as Array<{ genres?: { name?: string } | null }>)
    .map((wg) => wg.genres?.name)
    .filter((name): name is string => Boolean(name))

  return {
    ...data,
    alternative_titles: data.alternative_titles ?? [],
    category_scores: data.category_scores ?? [],
    platform_ratings: data.platform_ratings ?? [],
    calculated_scores: data.calculated_scores ?? null,
    work_covers: ((data.work_covers ?? []) as Array<{ position: number }>).slice().sort((a, b) => a.position - b.position),
    work_synopses: ((data.work_synopses ?? []) as Array<{ position: number }>).slice().sort((a, b) => a.position - b.position),
    genres,
    tags,
  }
}
