import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

export interface SimilarWork {
  id: string
  title: string
  similarity: number
  coverUrl: string | null
  synopsis: string | null
  finalScore: number | null
  personalFit: number | null
  manualScore: number | null
  genres: string[]
  year: number | null
  totalChapters: number | null
  publicationStatusId: number | null
  personalStatusId: number | null
  platformAvg: number | null
  totalVotes: number | null
}

interface RpcRow {
  id: string
  title: string
  similarity: number
  manual_score: number | null
  final_score: number | null
  personal_fit: number | null
  cover_url: string | null
  synopsis: string | null
}

interface WorkMetaRow {
  id: string
  year: number | null
  total_chapters: number | null
  publication_status_id: number | null
  personal_status_id: number | null
}

interface WorkGenreRow {
  work_id: string
  genres: { name: string } | { name: string }[] | null
}

/**
 * Top-K obras mais similares à obra alvo via cosine distance (`<=>`).
 *
 * Implementação via RPC `find_similar_works` (criada na migration 054) pra
 * permitir comparar embedding sem trafegar 1536 floats do server até o cliente
 * Supabase e voltar. Exclui a própria obra e obras arquivadas.
 *
 * Faz duas queries adicionais enxutas:
 * - `works`: metadados básicos (ano, capítulos, status)
 * - `work_genres` JOIN `genres`: gêneros reais (migration 014 substituiu o array
 *   legado works.genres por essa junção; o array fica vazio na maioria das obras).
 */
export async function getSimilarWorks(
  workId: string,
  limit = 10,
): Promise<SimilarWork[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc("find_similar_works", {
    target_work_id: workId,
    match_limit: limit,
  })

  if (error) {
    // Tipicamente "function does not exist" antes da migration rodar — degradar pra vazio
    console.warn("[similar-works] RPC falhou:", error.message)
    return []
  }

  const rows = (data as RpcRow[] | null) ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const [metaResult, genresResult, ratingsResult] = await Promise.all([
    supabase
      .from("works")
      .select("id, year, total_chapters, publication_status_id, personal_status_id")
      .in("id", ids),
    supabase
      .from("work_genres")
      .select("work_id, genres(name)")
      .in("work_id", ids),
    supabase
      .from("platform_ratings")
      .select("work_id, rating, vote_count")
      .in("work_id", ids),
  ])

  if (metaResult.error) {
    console.warn("[similar-works] meta query falhou:", metaResult.error.message)
  }
  if (genresResult.error) {
    console.warn("[similar-works] genres query falhou:", genresResult.error.message)
  }
  if (ratingsResult.error) {
    console.warn("[similar-works] ratings query falhou:", ratingsResult.error.message)
  }

  const metaById = new Map<string, WorkMetaRow>(
    ((metaResult.data as WorkMetaRow[] | null) ?? []).map((m) => [m.id, m]),
  )

  const ratingsByWorkId = new Map<string, Array<{ rating: number | null; vote_count: number }>>()
  for (const r of (ratingsResult.data ?? [])) {
    const list = ratingsByWorkId.get(r.work_id) ?? []
    list.push({
      rating: r.rating == null ? null : Number(r.rating),
      vote_count: Number(r.vote_count ?? 0),
    })
    ratingsByWorkId.set(r.work_id, list)
  }

  const genresByWorkId = new Map<string, string[]>()
  for (const row of (genresResult.data as WorkGenreRow[] | null) ?? []) {
    const list = Array.isArray(row.genres) ? row.genres : row.genres ? [row.genres] : []
    const names = list.map((g) => g.name).filter(Boolean)
    if (names.length === 0) continue
    const existing = genresByWorkId.get(row.work_id) ?? []
    existing.push(...names)
    genresByWorkId.set(row.work_id, existing)
  }

  return rows.map((r) => {
    const meta = metaById.get(r.id)
    const ratings = ratingsByWorkId.get(r.id) ?? []
    
    const rated = ratings.filter((pr) => pr.rating != null && pr.vote_count > 0)
    const totalVotes = ratings.reduce((sum, pr) => sum + pr.vote_count, 0)
    const platformAvg = rated.length > 0
      ? rated.reduce((sum, pr) => sum + (pr.rating as number) * pr.vote_count, 0) /
        rated.reduce((sum, pr) => sum + pr.vote_count, 0)
      : null

    return {
      id: r.id,
      title: r.title,
      similarity: Number(r.similarity),
      coverUrl: r.cover_url,
      synopsis: r.synopsis,
      finalScore: r.final_score == null ? null : Number(r.final_score),
      personalFit: r.personal_fit == null ? null : Number(r.personal_fit),
      manualScore: r.manual_score == null ? null : Number(r.manual_score),
      genres: genresByWorkId.get(r.id) ?? [],
      year: meta?.year ?? null,
      totalChapters: meta?.total_chapters ?? null,
      publicationStatusId: meta?.publication_status_id ?? null,
      personalStatusId: meta?.personal_status_id ?? null,
      platformAvg,
      totalVotes: totalVotes > 0 ? totalVotes : null,
    }
  })
}

// Re-exports usados pelo componente cliente
export { pickPrimaryCover, pickPrimarySynopsis }
