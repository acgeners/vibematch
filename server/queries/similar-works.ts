import { createAdminClient } from "@/lib/supabase/admin"
import { getSynopsisPredictionsByWorkIds } from "@/server/queries/synopsis-quality"
import { coverCandidates, pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"
import { getPersonalStateReader } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"

export interface SimilarWork {
  id: string
  title: string
  similarity: number
  /**
   * TODAS as capas em ordem de preferência, pro `<CoverImage urls>` cair na
   * próxima quando a primeira for link morto.
   *
   * 🔴 Não é `coverUrl` singular por medição, não por gosto: em 15/08/2026,
   * **29 das 988 obras (2,9%)** exibiam capa morta, e em **21** delas havia
   * alternativa VIVA na própria tabela — o app tinha a capa boa na mão e
   * mostrava o traço, porque recebia só a primeira. 23 das 29 são
   * `static.comix.to`, que caiu inteiro no Cloudflare de 11/08 (0 de 15 numa
   * amostra respondem 200) — o mesmo evento que matou o fetch de reviews da
   * Comix e levou as capas junto, sem nada acusar.
   */
  coverUrls: string[]
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
  /** Conteúdo adulto (18+) efetivo — works.is_adult. */
  isAdult: boolean
  platformAvg: number | null
  totalVotes: number | null
  /** Veredito IA (alignment_score, 0–100); NULL quando a obra não passou pelo re-rank. */
  alignmentScore: number | null
  alignmentStale: boolean
  /** Interesse manual (♥..♥♥♥♥) e previsto pela IA (synopsis_quality_predictions). */
  synopsisQuality: string | null
  /** True quando o Interesse manual foi APLICADO da previsão da IA (synopsis_quality_source = prediction_applied). */
  synopsisFromPrediction: boolean
  predictedSynopsisQuality: string | null
  predictedSynopsisStale: boolean
}

/** ⚠️ Sem `user_score`: a migration 151 o removeu da RPC (era a nota do DONO). */
interface RpcRow {
  id: string
  title: string
  similarity: number
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
  is_adult: boolean | null
  canonical_synopsis: string | null
}

/** Linha de `work_covers` no formato que o `coverCandidates` consome. */
interface WorkCoverPickRow {
  work_id: string
  url: string | null
  is_primary: boolean | null
  position: number | null
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
  const [metaResult, genresResult, ratingsResult, calcResult, coversResult, predictions] = await Promise.all([
    supabase
      .from("works")
      .select("id, year, total_chapters, publication_status_id, is_adult, canonical_synopsis")
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
    // ⚠️ Sem `.range()` de propósito: `ids` tem no máximo `limit` (hoje 8) e a
    // média é 4,2 capas por obra — ~34 linhas, longe do corte silencioso de 1000.
    // Se o `limit` do chamador passar de ~230, isto precisa paginar.
    supabase
      .from("work_covers")
      .select("work_id, url, is_primary, position")
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
  if (coversResult.error) {
    console.warn("[similar-works] covers query falhou:", coversResult.error.message)
  }

  /**
   * Candidatas por obra, na ordem de `coverCandidates` (is_primary, depois position).
   *
   * ⚠️ Essa é a MESMA ordem do `cover_url` que a RPC devolve
   * (`order by wc.is_primary desc nulls last, wc.position asc nulls last limit 1`),
   * então `coverUrls[0]` é exatamente a capa que aparecia antes: ligar o fallback
   * não muda qual capa a obra mostra quando ela funciona. E é por isso que o
   * `r.cover_url` da RPC deixou de ser lido — dois lugares calculando "qual é a
   * principal" é o jeito de eles discordarem depois.
   */
  const coverRowsByWorkId = new Map<string, WorkCoverPickRow[]>()
  for (const row of (coversResult.data as WorkCoverPickRow[] | null) ?? []) {
    const list = coverRowsByWorkId.get(row.work_id)
    if (list) list.push(row)
    else coverRowsByWorkId.set(row.work_id, [row])
  }
  const coverUrlsByWorkId = new Map<string, string[]>(
    [...coverRowsByWorkId].map(([workId, rows]) => [workId, coverCandidates(rows)]),
  )

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

  // Nota, ♥ e status são PESSOAIS (Fatias 1 e 2a) e vêm do espelho de quem olha — pra todo
  // mundo (Fase D). A RPC não devolve mais `user_score` (mig 151): era a nota do DONO, exibida
  // no card "Similares" de quem quer que abrisse a página.
  const personal = await getPersonalStateReader()
  // Fatia 2b: o card de Similares mostra expectedScore/personalFit/alignment de CADA obra
  // parecida — e eles vinham de `calculated_scores`, ou seja, do DONO. Era o vazamento que o
  // teste pegou na página da obra: a Nota Prevista dele nas obras similares, para ela.
  const scoresReader = await getScoresReader()

  return rows.map((r) => {
    const meta = metaById.get(r.id)
    // ⚠️ `expected_score` e `personal_fit` vêm da RPC (que junta `calculated_scores`), não do
    // select de `calc` — os dois lados precisam passar pelo overlay, senão a Nota Prevista DELE
    // volta pela porta dos fundos.
    const calc = scoresReader.overlay(r.id, {
      ...(calcById.get(r.id) ?? {}),
      expected_score: r.expected_score,
      personal_fit: r.personal_fit,
    })
    const pred = predictions.get(r.id)
    const ratings = ratingsByWorkId.get(r.id) ?? []
    const state = personal.get(r.id)

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
      coverUrls: coverUrlsByWorkId.get(r.id) ?? [],
      synopsis: canonical || r.synopsis,
      expectedScore: calc?.expected_score == null ? null : Number(calc.expected_score),
      personalFit: calc?.personal_fit == null ? null : Number(calc.personal_fit),
      personalFitPercentile:
        calc?.personal_fit_percentile == null ? null : Number(calc.personal_fit_percentile),
      userScore: state.userScore,
      genres: genresByWorkId.get(r.id) ?? [],
      year: meta?.year ?? null,
      totalChapters: meta?.total_chapters ?? null,
      publicationStatusId: meta?.publication_status_id ?? null,
      personalStatusId: state.personalStatusId,
      isAdult: Boolean(meta?.is_adult),
      platformAvg,
      totalVotes: totalVotes > 0 ? totalVotes : null,
      alignmentScore: calc?.alignment_score == null ? null : Number(calc.alignment_score),
      alignmentStale: Boolean(calc?.alignment_stale),
      synopsisQuality: state.synopsisQuality,
      synopsisFromPrediction: state.synopsisQualitySource === "prediction_applied",
      predictedSynopsisQuality: pred?.predictedQuality ?? null,
      predictedSynopsisStale: pred?.stale ?? false,
    }
  })
}

// Re-exports usados pelo componente cliente
export { pickPrimaryCover, pickPrimarySynopsis }
