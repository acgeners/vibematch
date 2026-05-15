import { searchAniList, fetchAniListById, fetchAniListReviews } from "./anilist"
import { extractUserRating } from "./index"
import { searchJikanManga, fetchJikanMangaByTitle, fetchJikanMangaReviews } from "./jikan"
import { searchMangaUpdates, fetchMangaUpdatesById, fetchMangaUpdatesReviews } from "./mangaupdates"
import type { ExternalSearchResult, SourcedReview } from "./types"

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const item = value?.trim()
    if (!item) continue
    const key = normalizeText(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function titleSimilarity(a: string, b: string) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9

  const aw = new Set(na.split(" ").filter((word) => word.length > 2))
  const bw = new Set(nb.split(" ").filter((word) => word.length > 2))
  if (!aw.size || !bw.size) return 0

  const intersection = [...aw].filter((word) => bw.has(word)).length
  return intersection / new Set([...aw, ...bw]).size
}

function bestTitleMatch(query: string, result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">) {
  const names = [result.title, result.originalTitle, ...(result.alternativeTitles ?? [])]
  return Math.max(...names.map((name) => titleSimilarity(query, name ?? "")), 0)
}

async function reviewsFromResult(workTitles: string[], result: ExternalSearchResult): Promise<SourcedReview[]> {
  const resultTitles = [result.title, result.originalTitle, ...(result.alternativeTitles ?? [])]
    .filter(Boolean) as string[]
  const matchScore = Math.max(
    ...workTitles.flatMap((wt) => resultTitles.map((rt) => titleSimilarity(wt, rt))),
    0
  )
  if (matchScore < 0.75) return []

  const [, sourceId] = result.id.split(":")
  const numericId = sourceId ? Number(sourceId) : NaN
  const reviews =
    result.source === "mangaupdates" && Number.isFinite(numericId)
      ? await fetchMangaUpdatesReviews(numericId)
      : result.source === "anilist" && Number.isFinite(numericId)
        ? await fetchAniListReviews(numericId)
        : result.source === "myanimelist" && Number.isFinite(numericId)
          ? await fetchJikanMangaReviews(numericId)
          : []

  return reviews
    .filter((text) => text.trim().length >= 100)
    .slice(0, 4)
    .map((text) => {
      const { rating, cleanText } = extractUserRating(text)
      return {
        source: result.source,
        sourceTitle: result.title,
        matchScore,
        text: cleanText,
        userRating: rating,
      }
    })
}

async function contextFromResult(result: ExternalSearchResult): Promise<string[]> {
  const [, sourceId] = result.id.split(":")
  const numericId = sourceId ? Number(sourceId) : NaN
  const detail =
    result.source === "mangaupdates" && Number.isFinite(numericId)
      ? await fetchMangaUpdatesById(numericId)
      : result.source === "anilist" && Number.isFinite(numericId)
        ? await fetchAniListById(numericId)
        : result.source === "myanimelist"
          ? await fetchJikanMangaByTitle(result.title)
          : null

  const detailSynopsis = detail && "synopsis" in detail ? detail.synopsis : undefined
  return uniqueStrings([
    result.synopsis,
    detailSynopsis,
  ])
}

async function findReviewCandidates(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}) {
  const queries = uniqueStrings([
    input.title,
    input.originalTitle,
    ...(input.alternativeTitles ?? []),
  ]).slice(0, 5)

  for (const query of queries) {
    const settled = await Promise.allSettled([
      searchMangaUpdates(query),
      searchAniList(query),
      searchJikanManga(query).then((items): ExternalSearchResult[] =>
        items.map((item) => ({
          id: `mal:${item.id}`,
          source: "myanimelist",
          title: item.title,
          alternativeTitles: item.alternativeTitles,
          synopsis: item.synopsis,
          coverUrl: item.coverUrl,
          year: item.year,
          chapters: item.chapters,
          score: item.score,
          votes: item.scoredBy,
        }))
      ),
    ])

    const candidates = settled
      .flatMap((entry) => entry.status === "fulfilled" ? entry.value : [])
      .map((result) => ({ result, matchScore: bestTitleMatch(query, result) }))
      .filter(({ matchScore }) => matchScore >= 0.62)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3)

    if (candidates.length) return { query, candidates }
  }

  return { query: input.title, candidates: [] }
}

export async function fetchExternalEvaluationContextForWork(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}): Promise<{ sourcedReviews: SourcedReview[]; externalContext: string[] }> {
  const { candidates } = await findReviewCandidates(input)
  const workTitles = uniqueStrings([input.title, input.originalTitle, ...(input.alternativeTitles ?? [])])
  const [reviews, context] = await Promise.all([
    Promise.all(candidates.map(({ result }) => reviewsFromResult(workTitles, result))),
    Promise.all(candidates.map(({ result }) => contextFromResult(result))),
  ])

  return {
    sourcedReviews: reviews.flat().slice(0, 12),
    externalContext: context.flat().slice(0, 6),
  }
}

export async function fetchExternalReviewsForWork(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}): Promise<SourcedReview[]> {
  const { sourcedReviews } = await fetchExternalEvaluationContextForWork(input)
  return sourcedReviews
}
