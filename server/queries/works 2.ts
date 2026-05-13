import { createClient } from "@/lib/supabase/server"
import type {
  WorkWithRelations,
  WorkFilters,
  WorkSort,
  PaginatedResult,
} from "@/types/domain"

const WORK_WITH_RELATIONS_SELECT = `
  *,
  category_scores(*),
  platform_ratings(*),
  calculated_scores(*),
  work_tags(tag_id, tags(*))
`

const WORK_LIST_SELECT = `
  id,
  title,
  original_title,
  alternative_titles,
  publication_status,
  personal_status,
  ai_eval_status,
  chapters_read,
  total_chapters,
  is_archived,
  created_at,
  updated_at,
  calculated_scores(final_score, calc_score, predicted_score, predicted_is_stub)
`

export async function getWorks(
  filters: WorkFilters = {},
  sort: WorkSort = { field: "final_score", direction: "desc" },
  page = 1,
  pageSize = 50
): Promise<PaginatedResult<WorkWithRelations>> {
  const supabase = await createClient()
  const searchTerm = filters.search?.trim()
  const needsClientScoreProcessing =
    sort.field === "final_score" ||
    sort.field === "calc_score" ||
    sort.field === "predicted_score" ||
    filters.minFinalScore != null ||
    filters.maxFinalScore != null ||
    Boolean(searchTerm)

  let query = supabase
    .from("works")
    .select(WORK_LIST_SELECT, { count: "exact" })

  // Filtros
  if (filters.publicationStatus?.length) {
    query = query.in("publication_status", filters.publicationStatus)
  }
  if (filters.personalStatus?.length) {
    query = query.in("personal_status", filters.personalStatus)
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
  if (filters.genres?.length) {
    query = query.overlaps("genres", filters.genres)
  }
  if (filters.tagSlugs?.length) {
    // Two-step: find work IDs that have all requested tags, then filter
    const { data: tagRows } = await supabase
      .from("work_tags")
      .select("work_id, tags!inner(slug)")
      .in("tags.slug", filters.tagSlugs)
    // Keep only works that have ALL selected tags (intersection per work)
    const countByWork: Record<string, number> = {}
    for (const r of tagRows ?? []) {
      countByWork[r.work_id] = (countByWork[r.work_id] ?? 0) + 1
    }
    const matchAll = Object.entries(countByWork)
      .filter(([, c]) => c >= filters.tagSlugs!.length)
      .map(([id]) => id)
    query = query.in("id", matchAll.length ? matchAll : ["00000000-0000-0000-0000-000000000000"])
  }
  if (filters.isArchived !== undefined) {
    query = query.eq("is_archived", filters.isArchived)
  } else {
    query = query.eq("is_archived", false)
  }

  if (needsClientScoreProcessing) {
    // calculated_scores é uma relação; para ordenar/filtrar por ela corretamente,
    // buscamos o conjunto filtrado inteiro, processamos no servidor e paginamos depois.
    query = query.order("title", { ascending: true })
  } else if (sort.field === "title") {
    query = query.order("title", { ascending: sort.direction === "asc" })
  } else {
    query = query.order(sort.field, { ascending: sort.direction === "asc" })
  }

  const from = (page - 1) * pageSize
  if (!needsClientScoreProcessing) {
    query = query.range(from, from + pageSize - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(error.message)

  // Filtrar por nota final (client-side, calculated_scores não é filtrável no Supabase sem RPC)
  let works = (data ?? []).map(normalizeWorkRelations)

  if (filters.minFinalScore != null) {
    works = works.filter((w) => (w.calculated_scores?.final_score ?? -1) >= filters.minFinalScore!)
  }
  if (searchTerm) {
    const normalizedSearch = searchTerm.toLowerCase()
    works = works.filter((w) => {
      const names = [
        w.title,
        w.original_title,
        ...(w.alternative_titles ?? []),
      ]
      return names.some((name) => name?.toLowerCase().includes(normalizedSearch))
    })
  }
  if (filters.maxFinalScore != null) {
    works = works.filter((w) => (w.calculated_scores?.final_score ?? 11) <= filters.maxFinalScore!)
  }

  // Reordenar por nota se necessário (client-side após fetch)
  if (sort.field === "final_score") {
    works.sort((a, b) => {
      const aScore = a.calculated_scores?.final_score ?? -1
      const bScore = b.calculated_scores?.final_score ?? -1
      return sort.direction === "desc" ? bScore - aScore : aScore - bScore
    })
  } else if (sort.field === "calc_score") {
    works.sort((a, b) => {
      const aScore = a.calculated_scores?.calc_score ?? -1
      const bScore = b.calculated_scores?.calc_score ?? -1
      return sort.direction === "desc" ? bScore - aScore : aScore - bScore
    })
  } else if (sort.field === "predicted_score") {
    works.sort((a, b) => {
      const aScore = a.calculated_scores?.predicted_score ?? -1
      const bScore = b.calculated_scores?.predicted_score ?? -1
      return sort.direction === "desc" ? bScore - aScore : aScore - bScore
    })
  }

  const total = needsClientScoreProcessing ? works.length : count ?? 0
  const paginatedWorks = needsClientScoreProcessing
    ? works.slice(from, from + pageSize)
    : works

  return {
    data: paginatedWorks,
    total,
    page,
    pageSize,
  }
}

export async function getWorkById(id: string): Promise<WorkWithRelations | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("works")
    .select(WORK_WITH_RELATIONS_SELECT)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return normalizeWorkRelations(data)
}

export async function getWorkWithAiEvaluations(id: string) {
  const supabase = await createClient()

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeWorkRelations(data: any): WorkWithRelations {
  return {
    ...data,
    alternative_titles: data.alternative_titles ?? [],
    category_scores: data.category_scores ?? [],
    platform_ratings: data.platform_ratings ?? [],
    calculated_scores: data.calculated_scores ?? null,
    tags: (data.work_tags ?? []).map((wt: { tags: unknown }) => wt.tags).filter(Boolean),
  }
}
