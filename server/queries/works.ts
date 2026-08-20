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
  getPersonalStatusNameById,
} from "@/lib/constants/status-lookups"
import { titleToSlug } from "@/lib/utils"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { foldTitle, titleTokens, workMatchesQuery } from "@/lib/title-match"
import { getPersonalStateReader } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { personalStatusNameOrDefault } from "@/lib/constants/status-lookups"

const WORK_WITH_RELATIONS_SELECT = `
  *,
  category_scores(*),
  platform_ratings(*),
  calculated_scores(*),
  work_tags(tag_id, source, confidence, tags(id, slug, name, tag_group_id, adult_score_tier)),
  work_genres(genre_id, genres(id, name, slug)),
  work_covers(id, url, source, is_primary, position),
  work_synopses(id, source, text, is_primary, position)
`

// ⚠️ Sem coluna pessoal (Fase D): status, capítulos, ♥, favorito e "última leitura" vêm do
// espelho de quem olha, via `withPersonalState()` — não da linha compartilhada de `works`.
const WORK_LIST_SELECT = `
  id,
  title,
  original_title,
  alternative_titles,
  publication_status_id,
  hiatus_kind,
  hiatus_kind_confidence,
  publication_status_note,
  ai_eval_status,
  total_chapters,
  is_archived,
  year,
  created_at,
  updated_at,
  calculated_scores(calc_score, expected_score, expected_baseline, expected_quality_adj, expected_is_stub, chance_score, chance_is_stub, personal_fit, personal_fit_percentile, art_percentile, alignment_score, alignment_justification, alignment_payload, alignment_stale, alignment_at, platform_avg, total_votes),
  category_scores(criterion_slug, score),
  work_covers(url, is_primary, position),
  work_tags(tag_id, tags(id, slug, name, tag_group_id)),
  work_genres(genre_id, genres(id, name, slug))
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFilterableQuery = any

// Supabase/PostgREST does not support a simple ilike over text[] values, so
// resolve title-search matches to IDs first and keep pagination/counts coherent.
// A normalização vem de lib/title-match.ts — a MESMA da busca do ranking e da
// detecção de duplicata (divergir aqui devolvia menos obras, sem erro nenhum).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSearchMatchIds(supabase: any, searchTerm: string | undefined): Promise<string[] | null> {
  if (!searchTerm) return null
  const tokens = titleTokens(searchTerm)
  if (!tokens.length) return null

  // Pagina: `.limit(1000)` estava a 94 obras de cortar em silêncio (906 hoje).
  const rows = await fetchAllRows<{
    id: string
    title: string | null
    original_title: string | null
    alternative_titles: string[] | null
  }>(
    (from, to) =>
      supabase.from("works").select("id, title, original_title, alternative_titles").range(from, to),
    "getSearchMatchIds",
  )

  return rows.filter((work) => workMatchesQuery(work, tokens)).map((work) => work.id)
}

/**
 * Resolve uma lista de títulos digitados (ex.: pelo chat) para obras do catálogo,
 * de forma determinística (sem LLM). Para cada título retorna:
 *  - `matched`   → 1 obra encontrada (melhor faixa de match)
 *  - `ambiguous` → várias obras na melhor faixa (o caller pede pra desambiguar)
 *  - `not_found` → nenhuma correspondência
 *
 * Ranqueia por faixa: igualdade exata > começa-com > contém (em qualquer um de
 * title/original_title/alternative_titles, normalizados por `foldTitle`).
 *
 * NÃO usa `matchTier` de lib/title-match: aqui a entrada é um título INTEIRO
 * digitado (pelo chat), então o casamento reverso importa — "The Villainess Flips
 * the Script (2021)" precisa resolver pra obra sem o "(2021)". A busca incremental
 * de /catalog quer o oposto (prefixo de token), por isso as duas faixas divergem
 * de propósito. A normalização, essa sim, é a mesma.
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
    .map(foldTitle)
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
    const normalizedQuery = foldTitle(query)
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
  // ⚠️ `personalStatus` e `isFavorite` NÃO são filtrados aqui — são PESSOAIS e saíram de
  // `works` (Fase D). Quem os aplica é `getWorks`, em memória, sobre o estado de quem olha:
  // no SQL, a obra sem linha no espelho (que É "Want to Read") sumiria em silêncio.
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
  if (searchMatchIds) {
    query = query.in("id", searchMatchIds.length ? searchMatchIds : ["00000000-0000-0000-0000-000000000000"])
  }
  return query
}

/**
 * ⚠️ SEM CALLERS hoje (a listagem inteira passa por `getRanking`). Se você reviver esta
 * função: os filtros `isFavorite`/`personalStatus` e o sort `is_favorite` abaixo batem nas
 * colunas de `works`, que são o estado do DONO — para qualquer outro usuário isso devolve os
 * favoritos DELE. Passe por `getPersonalStateReader()`/`resolvePersonalFilterIds()`, como
 * `getRanking` faz. Ver server/queries/user-work-state.ts.
 */
export async function getWorks(
  filters: WorkFilters = {},
  sort: WorkSort = { field: "expected_score", direction: "desc" },
  page = 1,
  pageSize = 50
): Promise<PaginatedResult<WorkWithRelations>> {
  const supabase = createAdminClient()
  const searchTerm = filters.search?.trim() || undefined

  // O estado pessoal de QUEM OLHA (Fase D) — favorito, status, capítulos, "última leitura".
  const personal = await getPersonalStateReader()

  // 🔴 Filtrar ou ordenar por estado pessoal NÃO PODE mais acontecer no SQL, e a razão é a
  // mesma dos outros lugares: o estado saiu de `works` e foi pro espelho, e uma obra SEM linha
  // no espelho **é** "Want to Read". Um `.in("personal_status_id", ...)` sobre uma lista de ids
  // só alcança quem TEM linha — as sem linha sumiriam do /catalog, em silêncio. E expressar "as
  // que não têm linha" como um `NOT IN (…)` de centenas de uuids estoura a URL do PostgREST
  // (o mesmo 400 que os `.in()` gigantes já causaram neste projeto).
  //
  // Então: qualquer filtro OU ordenação pessoal força o caminho de duas fases (busca leve →
  // filtra/ordena em memória → busca pesada só da página). O catálogo tem ~882 obras; a busca
  // leve é barata, e é a mesma máquina que os filtros de nota já usavam.
  const hasPersonalFilter = (filters.personalStatus?.length ?? 0) > 0 || filters.isFavorite === true
  const sortsByPersonal =
    sort.field === "is_favorite" ||
    sort.field === "last_read_at" ||
    sort.field === "personal_status"

  const needsClientScoreProcessing =
    sort.field === "expected_score" ||
    sortsByPersonal ||
    hasPersonalFilter ||
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
      ? fetchAllRows<{ work_id: string }>(
          (from, to) =>
            supabase
              .from("work_genres")
              .select("work_id, genres!inner(name)")
              .in("genres.name", filters.genres!)
              .range(from, to),
          "getWorks.genreMatchIds",
        ).then((rows) => [...new Set(rows.map((row) => row.work_id))])
      : Promise.resolve(null),
    filters.tagSlugs?.length
      ? // Uma tag popular sozinha não estoura o corte de 1000 (a maior do catálogo tem 894
        // vínculos), mas o filtro é `.in(<N slugs>)`: DUAS já somam mais. Truncado, obras
        // perdiam vínculo e caíam do "casa com TODAS as tags" — filtro devolvendo menos, sem erro.
        fetchAllRows<{ work_id: string }>(
          (from, to) =>
            supabase
              .from("work_tags")
              .select("work_id, tags!inner(slug)")
              .in("tags.slug", filters.tagSlugs!)
              .range(from, to),
          "getWorks.tagMatchIds",
        ).then((rows) => {
          const countByWork: Record<string, number> = {}
          for (const r of rows) {
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
    // 🔴 PAGINADA. Esta busca carrega TODAS as obras que casam o filtro pra ordenar por nota
    // e só então recortar a página — então truncar aqui não devolve menos numa página, some
    // com a obra de TODAS elas. O comentário acima dizia "o catálogo tem ~882 obras; a busca
    // leve é barata", e era a premissa que a tornava segura: em 2026-08-18 o catálogo tem
    // 1009 ativas e o PostgREST corta em 1000 sem erro. Ninguém editou o arquivo — o número
    // é que mudou.
    const lightData = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        applyWorkFilters(
          supabase
            .from("works")
            .select(
              "id, calculated_scores(expected_score, personal_fit, personal_fit_percentile, total_votes)",
            ),
          filters,
          searchMatchIds,
          genreMatchIds,
          tagMatchIds,
        ).range(from, to),
      "getWorks.lightQuery",
    )

    type LightRow = {
      id: string
      /** Do ESPELHO de quem olha — não da coluna de `works` (que é o favorito do dono). */
      isFavorite: boolean
      personalStatusId: number | null
      lastReadAt: string | null
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
      const id = (row as { id: string }).id
      const state = personal.get(id)
      return {
        id,
        isFavorite: state.isFavorite,
        personalStatusId: state.personalStatusId,
        lastReadAt: state.lastReadAt,
        calculated_scores: flat as LightRow["calculated_scores"],
      }
    })

    // Os filtros pessoais, agora sobre o estado de quem olha. `getPersonalStatusNameById(null)`
    // cai em "Want to Read" — é aqui que a obra sem linha no espelho é corretamente contada,
    // que é justamente o que o SQL não conseguia dizer.
    if (filters.personalStatus?.length) {
      const wanted = new Set<string>(filters.personalStatus)
      scored = scored.filter((w) =>
        wanted.has(personalStatusNameOrDefault(w.personalStatusId)),
      )
    }
    if (filters.isFavorite) {
      scored = scored.filter((w) => w.isFavorite)
    }

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

    const dir = sort.direction === "asc" ? -1 : 1

    if (sort.field === "is_favorite") {
      // Favoritos primeiro (ou último, se asc); desempate por Nota Prevista desc.
      scored.sort((a, b) => {
        const favDelta = Number(b.isFavorite) - Number(a.isFavorite)
        if (favDelta !== 0) return sort.direction === "asc" ? -favDelta : favDelta
        const aScore = a.calculated_scores?.expected_score ?? -1
        const bScore = b.calculated_scores?.expected_score ?? -1
        return bScore - aScore
      })
    } else if (sort.field === "last_read_at") {
      // Era um `.order("last_read_at")` no SQL — a data que estava em `works`, ou seja, a do
      // DONO. Agora é a de quem olha. Nulos por último nos dois sentidos (era `nullsFirst: false`).
      scored.sort((a, b) => {
        if (a.lastReadAt === b.lastReadAt) return 0
        if (a.lastReadAt == null) return 1
        if (b.lastReadAt == null) return -1
        return dir * b.lastReadAt.localeCompare(a.lastReadAt)
      })
    } else if (sort.field === "personal_status") {
      scored.sort((a, b) => {
        const an = personalStatusNameOrDefault(a.personalStatusId)
        const bn = personalStatusNameOrDefault(b.personalStatusId)
        return dir * -an.localeCompare(bn)
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

/**
 * PREENCHE o estado pessoal de quem está olhando no objeto de obra que a UI consome.
 *
 * Antes isto SOBREPUNHA colunas que vinham de `works` (o estado do dono) pelas do usuário. A
 * partir da Fase D não há o que sobrepor: `works` não traz mais coluna pessoal nenhuma, e estes
 * campos nascem aqui, do espelho de quem olha. Obra sem linha = estado vazio.
 *
 * ⚠️ Isto é a camada de UI. O SCORING não passa por aqui — ele lê os rótulos DO DONO
 * (`works_owner` / o espelho dele), que é com o que o modelo dele foi treinado. Trocar um pelo
 * outro faria o modelo aprender o gosto de quem abriu a página.
 *
 * Ver server/queries/user-work-state.ts.
 */
async function withPersonalState(works: WorkWithRelations[]): Promise<WorkWithRelations[]> {
  const [personal, scores] = await Promise.all([getPersonalStateReader(), getScoresReader()])
  return works.map((work) => {
    const state = personal.get(work.id)
    return {
      ...work,
      // Fatia 2b: a Nota Prevista, a Chance e o Alinhamento são de QUEM OLHA. Os campos de
      // catálogo da mesma linha (platform_avg = nota da comunidade, total_votes) passam
      // intactos — é o que sobra, e basta, para quem ainda não tem modelo.
      calculated_scores: scores.overlay(work.id, work.calculated_scores ?? null),
      is_favorite: state.isFavorite,
      personal_status_id: state.personalStatusId,
      chapters_read: state.chaptersRead,
      last_read_at: state.lastReadAt,
      user_score: state.userScore,
      observations: state.observations,
      observation_adjustment: state.observationAdjustment,
      synopsis_quality: state.synopsisQuality,
      synopsis_quality_source: state.synopsisQualitySource,
      synopsis_quality_prediction_id: state.synopsisQualityPredictionId,
      synopsis_interest_skipped: state.synopsisInterestSkipped,
      ...state.postScores,
    }
  })
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

  const [work] = await withPersonalState([normalizeWorkRelations(data)])
  return work
}

// Map of slug -> work id, cached so navigating to a work by slug doesn't refetch
// the entire works table on every click. Invalidated by revalidateTag("works-slug-index")
// from server actions that mutate the works table.
const getSlugToIdMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const supabase = createAdminClient()
    // Pagina: `.select()` corta em 1000 linhas sem avisar. Acima disso, obras na
    // cauda sumiriam do índice slug→id → 404 ao navegar/renomear (gotcha nº1).
    const rows = await fetchAllRows<{ id: string; title: string | null }>(
      (from, to) => supabase.from("works").select("id, title").range(from, to),
      "getSlugToIdMap",
    )
    const map: Record<string, string> = {}
    for (const row of rows) {
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
  let id: string | undefined = map[slug]
  if (!id) {
    // O índice slug→id é cacheado e a invalidação por tag pode não propagar
    // a tempo da navegação após criar uma obra. Fallback: consulta direta no
    // banco para evitar 404 em obras recém-criadas. Pagina (`.select()` corta
    // em 1000) — senão a obra da cauda cairia justo aqui, no caminho de 404.
    const supabase = createAdminClient()
    const rows = await fetchAllRows<{ id: string; title: string | null }>(
      (from, to) => supabase.from("works").select("id, title").range(from, to),
      "getWorkBySlug.fallback",
    )
    id = rows.find((row) => titleToSlug(row.title ?? "") === slug)?.id
    if (!id) {
      // Alias (migration 162): o slug pode ser um slug ANTIGO de um título renomeado.
      // `previous_slugs` guarda os slugs de títulos anteriores → resolve pra obra atual e a
      // página redireciona pro slug canônico, em vez de 404 (Voltar/bookmark/aba). Best-effort:
      // se a coluna ainda não existe, `error` vem setado e a busca só cai no 404 de antes.
      const { data: aliasRows, error } = await supabase
        .from("works")
        .select("id")
        .contains("previous_slugs", [slug])
        .limit(1)
      if (!error && aliasRows && aliasRows.length > 0) id = aliasRows[0].id as string
    }
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

/**
 * Capas que você apagou na edição (migration 163). Ficam FORA de `work_covers`
 * de propósito: assim nenhum dos ~25 pontos que leem capa precisa filtrar nada —
 * quem lê capa só enxerga capa viva. Só os gravadores consultam esta lista.
 *
 * Fail-soft: erro aqui devolve lista vazia. A consequência é a capa arquivada
 * poder reaparecer numa atualização — chato, não destrutivo — enquanto lançar
 * derrubaria a página de edição inteira.
 */
export async function getArchivedCovers(
  workId: string,
): Promise<Array<{ url: string; source: string | null }>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_cover_archive")
    .select("url, source")
    .eq("work_id", workId)
    .order("archived_at", { ascending: false })
  if (error) {
    console.error("[getArchivedCovers] failed:", error.message)
    return []
  }
  return (data ?? []).map((r) => ({ url: r.url as string, source: (r.source as string) ?? null }))
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
  // Pagina (`.select()` corta em 1000): sem isto o título de uma obra na cauda
  // viria null e a aba do navegador cairia no fallback genérico.
  const rows = await fetchAllRows<{ title: string | null; previous_slugs: string[] | null }>(
    (from, to) => supabase.from("works").select("title, previous_slugs").range(from, to),
    "getWorkTitleByIdOrSlug",
  )
  const canonico = rows.find((row) => titleToSlug(row.title ?? "") === idOrSlug)
  if (canonico) return canonico.title ?? null
  /**
   * 🔴 Slug ANTIGO (`previous_slugs`, migration 162) também tem que resolver. Antes de
   * 2026-08-20 a página REDIRECIONAVA a URL velha pro slug canônico, então o metadata era
   * resolvido lá e esta função nunca via um alias. Sem o redirect (ele derrubava a página —
   * ver o comentário em `app/catalog/[id]/page.tsx`), a URL velha é servida como está: sem
   * isto, as 14 obras renomeadas abrem com a aba dizendo "SatorIA" e sem canonical, que é
   * justamente quem passou a apontar a URL de verdade.
   */
  return rows.find((row) => (row.previous_slugs ?? []).includes(idOrSlug))?.title ?? null
}

export async function getWorkIdsBySlug(slug: string): Promise<string[]> {
  const supabase = createAdminClient()
  // Pagina (`.select()` corta em 1000). Aqui o custo do truncamento é DOBRADO:
  // a detail page usa esta contagem pra decidir o redirect UUID→slug (só redireciona
  // se o slug for único). Uma obra da cauda perdida daria falso "não-único".
  const rows = await fetchAllRows<{ id: string; title: string | null }>(
    (from, to) => supabase.from("works").select("id, title").range(from, to),
    "getWorkIdsBySlug",
  )
  return rows
    .filter((row) => titleToSlug(row.title ?? "") === slug)
    .map((row) => row.id)
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

  // ⚠️ Este é o caminho da PÁGINA DA OBRA (`getWorkBySlug` → aqui) — um caminho SEPARADO do
  // `getWorkById`. Sem o overlay, ele entregava as colunas pessoais cruas de `works`: a página
  // da Leitora abria o formulário de status já preenchido com o capítulo 49 DELE e a nota 7,9
  // DELE. Passou batido na Fatia 1 porque o teste da página da obra só conferia o CATÁLOGO
  // (título, capa, tags, notas da IA) — o estado pessoal ali nunca tinha sido checado.
  const [work] = await withPersonalState([normalizeWorkRelations(data)])

  return {
    ...work,
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
  return withPersonalState(
    ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map(normalizeWorkRelations),
  )
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
