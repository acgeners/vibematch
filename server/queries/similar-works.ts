import { createAdminClient } from "@/lib/supabase/admin"
import { getSynopsisPredictionsByWorkIds } from "@/server/queries/synopsis-quality"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

export interface SimilarWork {
  id: string
  title: string
  similarity: number
  coverUrl: string | null
  synopsis: string | null
  expectedScore: number | null
  personalFit: number | null
  /** Percentil de Alinhamento (0–100) dentro da biblioteca; fallback pro cru×100. */
  personalFitPercentile: number | null
  userScore: number | null
  genres: string[]
  year: number | null
  totalChapters: number | null
  publicationStatusId: number | null
  personalStatusId: number | null
  platformAvg: number | null
  totalVotes: number | null
  /** Veredito IA (alignment_score, 0–100); NULL quando a obra não passou pelo re-rank. */
  alignmentScore: number | null
  alignmentStale: boolean
  /** Interesse manual (♥..♥♥♥♥) e previsto pela IA (synopsis_quality_predictions). */
  synopsisQuality: string | null
  predictedSynopsisQuality: string | null
  predictedSynopsisStale: boolean
}

interface RpcRow {
  id: string
  title: string
  similarity: number
  user_score: number | null
  expected_score: number | null
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
  synopsis_quality: string | null
  canonical_synopsis: string | null
}

interface WorkGenreRow {
  work_id: string
  genres: { name: string } | { name: string }[] | null
}

interface CalcRow {
  work_id: string
  personal_fit_percentile: number | null
  alignment_score: number | null
  alignment_stale: boolean | null
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
  const [metaResult, genresResult, ratingsResult, calcResult, predictions] = await Promise.all([
    supabase
      .from("works")
      .select("id, year, total_chapters, publication_status_id, personal_status_id, synopsis_quality, canonical_synopsis")
      .in("id", ids),
    supabase
      .from("work_genres")
      .select("work_id, genres(name)")
      .in("work_id", ids),
    supabase
      .from("platform_ratings")
      .select("work_id, rating, vote_count")
      .in("work_id", ids),
    supabase
      .from("calculated_scores")
      .select("work_id, personal_fit_percentile, alignment_score, alignment_stale")
      .in("work_id", ids),
    getSynopsisPredictionsByWorkIds(ids),
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
  if (calcResult.error) {
    console.warn("[similar-works] calc query falhou:", calcResult.error.message)
  }

  const metaById = new Map<string, WorkMetaRow>(
    ((metaResult.data as WorkMetaRow[] | null) ?? []).map((m) => [m.id, m]),
  )

  const calcById = new Map<string, CalcRow>(
    ((calcResult.data as CalcRow[] | null) ?? []).map((c) => [c.work_id, c]),
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
    const calc = calcById.get(r.id)
    const pred = predictions.get(r.id)
    const ratings = ratingsByWorkId.get(r.id) ?? []

    const rated = ratings.filter((pr) => pr.rating != null && pr.vote_count > 0)
    const totalVotes = ratings.reduce((sum, pr) => sum + pr.vote_count, 0)
    const platformAvg = rated.length > 0
      ? rated.reduce((sum, pr) => sum + (pr.rating as number) * pr.vote_count, 0) /
        rated.reduce((sum, pr) => sum + pr.vote_count, 0)
      : null

    // Sinopse canônica (consolidada por IA) quando existe; cai na sinopse da RPC.
    const canonical = (meta?.canonical_synopsis ?? "").trim()

    return {
      id: r.id,
      title: r.title,
      similarity: Number(r.similarity),
      coverUrl: r.cover_url,
      synopsis: canonical || r.synopsis,
      expectedScore: r.expected_score == null ? null : Number(r.expected_score),
      personalFit: r.personal_fit == null ? null : Number(r.personal_fit),
      personalFitPercentile:
        calc?.personal_fit_percentile == null ? null : Number(calc.personal_fit_percentile),
      userScore: r.user_score == null ? null : Number(r.user_score),
      genres: genresByWorkId.get(r.id) ?? [],
      year: meta?.year ?? null,
      totalChapters: meta?.total_chapters ?? null,
      publicationStatusId: meta?.publication_status_id ?? null,
      personalStatusId: meta?.personal_status_id ?? null,
      platformAvg,
      totalVotes: totalVotes > 0 ? totalVotes : null,
      alignmentScore: calc?.alignment_score == null ? null : Number(calc.alignment_score),
      alignmentStale: Boolean(calc?.alignment_stale),
      synopsisQuality: meta?.synopsis_quality ?? null,
      predictedSynopsisQuality: pred?.predictedQuality ?? null,
      predictedSynopsisStale: pred?.stale ?? false,
    }
  })
}

// Re-exports usados pelo componente cliente
export { pickPrimaryCover, pickPrimarySynopsis }
