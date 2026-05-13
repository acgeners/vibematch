import { searchAniList, fetchAniListById, fetchAniListReviews } from "./anilist"
import { searchAnimePlanet, fetchAnimePlanetByTitle } from "./animeplanet"
import type { AnimePlanetDetail } from "./animeplanet"
import { searchComicK, fetchComicKByHid } from "./comick"
import { searchComix, fetchComixById } from "./comix"
import { searchJikanManga, fetchJikanMangaById, fetchJikanMangaReviews } from "./jikan"
import { searchKitsuManga, fetchKitsuMangaById, fetchKitsuReactions } from "./kitsu"
import { searchMangaDex, fetchMangaDexById } from "./mangadex"
import { searchMangaUpdates, fetchMangaUpdatesById, fetchMangaUpdatesReviews } from "./mangaupdates"
import type {
  ConflictField,
  ConflictOption,
  ExternalMergeDebug,
  ExternalSearchResult,
  ExternalSourceDebug,
  ExternalSourceId,
  ExternalWorkData,
  MergedCandidate,
  MultiSourceResult,
  SourcedReview,
} from "./types"

// ============================================================================
// Text utilities
// ============================================================================

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

  if (nb.includes(na)) return 0.9

  // Query contains the candidate. Only treat as high-confidence when the candidate
  // is substantial — otherwise a common word inside a long query (e.g. "Marriage"
  // inside "Elissa's Whirlwind Marriage") yields a false positive.
  if (na.includes(nb)) {
    const shortWords = nb.split(" ").filter((w) => w.length > 2).length
    if (nb.length / na.length >= 0.6 || shortWords >= 2) return 0.9
  }

  const aw = new Set(na.split(" ").filter((w) => w.length > 2))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return 0
  const intersection = [...aw].filter((word) => bw.has(word)).length
  return intersection / new Set([...aw, ...bw]).size
}

function bestTitleMatch(query: string, result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">) {
  const names = [result.title, result.originalTitle, ...(result.alternativeTitles ?? [])]
  return Math.max(...names.map((name) => titleSimilarity(query, name ?? "")), 0)
}

function altTitleOverlap(a: Array<string | null | undefined> = [], b: Array<string | null | undefined> = []): number {
  const setA = new Set(a.map((value) => normalizeText(value ?? "")).filter(Boolean))
  const setB = new Set(b.map((value) => normalizeText(value ?? "")).filter(Boolean))
  if (!setA.size || !setB.size) return 0
  const intersection = [...setA].filter((value) => setB.has(value)).length
  return intersection / Math.min(setA.size, setB.size)
}

/**
 * Composite acceptance score used at the hydrate-filter stage of fetchMultiSourceDetails.
 * Combines title, synopsis, alt-title overlap and year proximity. Applies a penalty
 * when chapter counts diverge dramatically (>6×) — likely a different work that
 * happens to share the title.
 */
function compositeAcceptScore(
  candidate: MergedCandidate,
  result: ExternalSearchResult
): { titleScore: number; synScore: number; composite: number; reason?: string } {
  const titleScore = Math.max(
    bestTitleMatch(candidate.title, result),
    ...(candidate.alternativeTitles ?? []).map((alt) => bestTitleMatch(alt, result))
  )
  const synScore = synopsisSimilarity(candidate.synopsis, result.synopsis)
  const altOverlap = altTitleOverlap(
    [candidate.title, ...(candidate.alternativeTitles ?? [])],
    [result.title, result.originalTitle, ...(result.alternativeTitles ?? [])]
  )
  const yearProximity =
    candidate.year != null && result.year != null && Math.abs(candidate.year - result.year) <= 2 ? 1 : 0

  let chapterPenalty = 0
  if (candidate.chapters && result.chapters) {
    const ratio = Math.max(candidate.chapters, result.chapters) / Math.max(1, Math.min(candidate.chapters, result.chapters))
    if (ratio > 6) chapterPenalty = 0.2
  }

  const composite = 0.5 * titleScore + 0.3 * synScore + 0.15 * altOverlap + 0.05 * yearProximity - chapterPenalty

  let reason: string | undefined
  if (titleScore < 0.62) reason = `título não bate (score=${titleScore.toFixed(2)})`
  else if (synScore < 0.18) reason = `sinopse divergente (score=${synScore.toFixed(2)})`
  else if (composite < 0.55) reason = `score composto baixo (${composite.toFixed(2)})`
  else if (chapterPenalty > 0) reason = `divergência forte de capítulos (penalidade aplicada)`

  return { titleScore, synScore, composite, reason: composite < 0.55 || titleScore < 0.62 || synScore < 0.18 ? reason : undefined }
}

// ============================================================================
// Synopsis cleanup
// ============================================================================

function cleanSynopsisPre(text: string | null | undefined): string {
  if (!text) return ""
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:039|x27);/gi, "'")
    .replace(/\[([^\]]*)\]\(https?:\/\/[^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[(?:source|src|via|from|written\s+by|translation|official)[^\]]{0,160}\]/gi, "")
    .replace(/\((?:source|src|via|from|written\s+by|translation|official)[^)]{0,160}\)/gi, "")
    .replace(/^\s*R19\s*:\s*[^\n]+$/gim, "R19")
    .replace(/^\s*R(?:15|18)\s*:\s*[^\n]+$/gim, "")
    .replace(/\s*\*{0,2}\s*(?:original\s+(?:webtoon|comic|manhwa|manga|work|source)|official\s+(?:translations?|release)|season\s+\d+\s+(?:author|artist)|published\s+(?:by|in|on)|serialized\s+(?:in|by))\s*\*{0,2}\s*[:\s].*/gim, "")
    .replace(/^\s*(?:links?|notes?|source|from|via)\s*:?\s*$/gim, "")
    .replace(/^\s*[*•]\s+[^\n]*$/gm, "")
    .replace(/\*+/g, "")
    .replace(/^\s*-{2,}\s*$/gm, "")
    .replace(/(?:^|\n)\s*R19\s*(?=(?:\n\s*R19\s*)+)/gi, "")
    .replace(/\n{2,}(?!R19\s*$)[^\n]{0,80}$/, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function splitSynopsisBlocks(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?:^|\n)\s*(?:-{3,}|_{3,}|={3,})\s*(?:\n|$)/g)
    .map(cleanSynopsisPre)
    .filter((block) => block.length > 0)
}

function normalizeSynopsisForComparison(text: string): string {
  return cleanSynopsisPre(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function synopsisDuplicateScore(a: string, b: string): number {
  const na = normalizeSynopsisForComparison(a)
  const nb = normalizeSynopsisForComparison(b)
  if (!na || !nb) return 0
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1

  const aw = new Set(na.split(" ").filter((word) => word.length > 2))
  const bw = new Set(nb.split(" ").filter((word) => word.length > 2))
  if (!aw.size || !bw.size) return 0

  const intersection = [...aw].filter((word) => bw.has(word)).length
  const overlap = intersection / Math.min(aw.size, bw.size)
  const jaccard = intersection / new Set([...aw, ...bw]).size
  return Math.min(overlap, jaccard / 0.78)
}

function uniqueSynopsisBlocks(values: Array<string | null | undefined>): string[] {
  const result: string[] = []
  for (const block of values.flatMap(splitSynopsisBlocks)) {
    const norm = normalizeSynopsisForComparison(block)
    if (!norm) continue
    const alreadyCovered = result.some((r) => {
      const rn = normalizeSynopsisForComparison(r)
      return rn === norm || rn.includes(norm) || norm.includes(rn) || synopsisDuplicateScore(r, block) >= 0.92
    })
    if (!alreadyCovered) result.push(block)
  }
  return result
}

/**
 * Like uniqueSynopsisBlocks but tracks the source each surviving block came from.
 * Used by Fase 2 to surface multiSynopses in ExternalWorkData so the user can
 * cherry-pick which one(s) to keep.
 */
function uniqueSynopsisBlocksWithSource(
  inputs: Array<{ source: ExternalSourceId; text: string | null | undefined }>
): Array<{ source: ExternalSourceId; text: string }> {
  const result: Array<{ source: ExternalSourceId; text: string }> = []
  const expanded = inputs.flatMap((entry) =>
    splitSynopsisBlocks(entry.text).map((block) => ({ source: entry.source, text: block }))
  )
  for (const entry of expanded) {
    if (!entry.text) continue
    const norm = normalizeSynopsisForComparison(entry.text)
    if (!norm) continue
    const alreadyCovered = result.some((r) => {
      const rn = normalizeSynopsisForComparison(r.text)
      return rn === norm || rn.includes(norm) || norm.includes(rn) || synopsisDuplicateScore(r.text, entry.text) >= 0.92
    })
    if (!alreadyCovered) result.push(entry)
  }
  return result
}

function synopsisSimilarity(a?: string, b?: string) {
  const na = normalizeText(cleanSynopsisPre(a))
  const nb = normalizeText(cleanSynopsisPre(b))
  if (!na || !nb) return 0.5
  const aw = new Set(na.split(" ").filter((w) => w.length > 4))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 4))
  if (!aw.size || !bw.size) return 0.5
  const intersection = [...aw].filter((word) => bw.has(word)).length
  return intersection / Math.min(aw.size, bw.size)
}

function sourceId(result: ExternalSearchResult) {
  return result.id.split(":").slice(1).join(":")
}

function sourceDebug(result: ExternalSearchResult, accepted: boolean, reason?: string): ExternalSourceDebug {
  return {
    source: result.source,
    sourceId: sourceId(result),
    title: result.title,
    originalTitle: result.originalTitle,
    alternativeTitles: result.alternativeTitles ?? [],
    matchScore: result.score ?? 0,
    accepted,
    rejectionReason: reason,
    synopsis: result.synopsis,
    coverUrl: result.coverUrl,
    year: result.year,
    yearEnd: result.yearEnd,
    publicationStatus: result.publicationStatus,
    chapters: result.chapters,
    score: result.score,
    votes: result.votes,
    genres: result.genres ?? [],
    tags: [],
    reviews: [],
  }
}

const EXCLUDED_TITLE_SUFFIXES = /\s*\((novel|promo|promotion)\)\s*$/i

function isExcludedResult(result: ExternalSearchResult): boolean {
  return EXCLUDED_TITLE_SUFFIXES.test(result.title ?? "")
}

// ============================================================================
// Search + merge
// ============================================================================

function mergeSearchResults(query: string, results: ExternalSearchResult[]): MergedCandidate[] {
  const filtered = results
    .filter((result) => !isExcludedResult(result))
    .map((result) => ({ result, matchScore: bestTitleMatch(query, result) }))
    .filter(({ matchScore }) => matchScore >= 0.62)
    .sort((a, b) => b.matchScore - a.matchScore)

  const groups: Array<{ main: ExternalSearchResult; matchScore: number; results: ExternalSearchResult[] }> = []
  for (const item of filtered) {
    const group = groups.find((existing) => {
      const sameTitle = bestTitleMatch(existing.main.title, item.result) >= 0.78
      // Lowered from 0.15 → 0.05: when title matches strongly, even minor synopsis
      // overlap should be enough. Some sources (Kitsu) return very different synopsis
      // formatting that gives spuriously low similarity.
      const compatibleSynopsis = synopsisSimilarity(existing.main.synopsis, item.result.synopsis) >= 0.05
      return sameTitle && compatibleSynopsis
    })
    if (group) {
      group.results.push(item.result)
      group.matchScore = Math.max(group.matchScore, item.matchScore)
    } else {
      groups.push({ main: item.result, matchScore: item.matchScore, results: [item.result] })
    }
  }

  // Post-pass: collapse groups whose main titles collapse to the SAME alphanumeric-only
  // string. Catches case differences ("Is" vs "is"), hyphenation ("Newlywed" vs
  // "Newly-wed"), punctuation differences (": Vol" vs "Vol"), and whitespace variation.
  // Also tries every candidate's alternativeTitles for cross-matching.
  const stripAll = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "")
  const groupKeys = (g: { main: ExternalSearchResult; results: ExternalSearchResult[] }): Set<string> => {
    const titles = g.results.flatMap((r) => [r.title, r.originalTitle, ...(r.alternativeTitles ?? [])])
    return new Set(titles.map(stripAll).filter(Boolean))
  }
  for (let i = 0; i < groups.length; i += 1) {
    const a = groups[i]
    const aKeys = groupKeys(a)
    if (aKeys.size === 0) continue
    for (let j = groups.length - 1; j > i; j -= 1) {
      const b = groups[j]
      const bKeys = groupKeys(b)
      const overlap = [...bKeys].some((k) => aKeys.has(k))
      if (!overlap) continue
      // merge b into a, then remove b
      a.results.push(...b.results.filter((r) => !a.results.some((existing) => existing.id === r.id)))
      a.matchScore = Math.max(a.matchScore, b.matchScore)
      // refresh aKeys with newly merged alts
      for (const k of bKeys) aKeys.add(k)
      groups.splice(j, 1)
    }
  }

  return groups.slice(0, 8).map(({ main, matchScore, results }) => {
    const bySource = new Map(results.map((result) => [result.source, result]))
    const primary = bySource.get("mangaupdates") ?? main
    const muId = bySource.get("mangaupdates")?.id.split(":")[1]
    const malId = bySource.get("myanimelist")?.id.split(":")[1]
    return {
      title: primary.title,
      originalTitle: primary.originalTitle,
      alternativeTitles: uniqueStrings(results.flatMap((result) => [
        result.originalTitle,
        ...(result.alternativeTitles ?? []),
      ])),
      synopsis: primary.synopsis ?? main.synopsis,
      coverUrl: primary.coverUrl ?? main.coverUrl,
      year: primary.year ?? main.year,
      yearEnd: primary.yearEnd ?? main.yearEnd,
      publicationStatus: primary.publicationStatus ?? main.publicationStatus,
      chapters: primary.chapters ?? main.chapters,
      score: primary.score ?? main.score,
      genres: uniqueStrings(results.flatMap((result) => result.genres ?? [])),
      anilistId: bySource.get("anilist") ? Number(bySource.get("anilist")!.id.split(":")[1]) : undefined,
      muId: muId ? Number(muId) : undefined,
      kitsuId: bySource.get("kitsu")?.id.split(":")[1],
      mangadexId: bySource.get("mangadex")?.id.split(":")[1],
      malId: malId ? Number(malId) : undefined,
      comickHid: bySource.get("comick")?.id.split(":")[1],
      comixHid: bySource.get("comix")?.id.split(":")[1],
      animePlanetSlug: bySource.get("animeplanet")?.id.split(":")[1],
      matchScore,
      sources: [...new Set(results.map((result) => result.source))],
      sourceResults: results,
    }
  })
}

type SearchConnector = {
  source: ExternalSourceId
  search: (query: string) => Promise<ExternalSearchResult[]>
}

const SEARCH_CONNECTORS = [
  { source: "anilist", search: searchAniList },
  { source: "mangaupdates", search: searchMangaUpdates },
  { source: "comick", search: searchComicK },
  {
    source: "kitsu",
    search: async (query: string) => {
      const results = await searchKitsuManga(query)
      return results.map((item): ExternalSearchResult => ({
        id: `kitsu:${item.id}`,
        source: "kitsu",
        title: item.title,
        alternativeTitles: item.alternativeTitles,
        synopsis: item.synopsis,
        coverUrl: item.coverUrl,
        year: item.year,
        chapters: item.chapters,
        score: item.averageRating != null ? Math.round((item.averageRating / 10) * 10) / 10 : undefined,
        votes: item.userCount,
      }))
    },
  },
  {
    source: "myanimelist",
    search: async (query: string) => {
      const results = await searchJikanManga(query)
      return results.map((item): ExternalSearchResult => ({
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
    },
  },
  {
    source: "mangadex",
    search: async (query: string) => {
      const results = await searchMangaDex(query)
      return results.map((item): ExternalSearchResult => ({
        id: `mangadex:${item.id}`,
        source: "mangadex",
        title: item.title,
        alternativeTitles: item.alternativeTitles,
        synopsis: item.synopsis,
        coverUrl: item.coverUrl,
        year: item.year,
        chapters: item.chapters,
      }))
    },
  },
  { source: "animeplanet", search: searchAnimePlanet },
  { source: "comix", search: searchComix },
] satisfies SearchConnector[]

export async function searchAllSources(query: string): Promise<MergedCandidate[]> {
  const settled = await Promise.allSettled(
    SEARCH_CONNECTORS.map((connector) => connector.search(query))
  )
  const results = settled.flatMap((entry, i) => {
    if (entry.status === "fulfilled") return entry.value
    console.error(
      `[searchAllSources] connector ${SEARCH_CONNECTORS[i].source} failed for query="${query}"`,
      entry.reason instanceof Error ? entry.reason.message : entry.reason
    )
    return []
  })
  return mergeSearchResults(query, results)
}

// ============================================================================
// Review aggregation across sources (Sprint 1)
// ============================================================================

/**
 * Priority order applied to reviews fed to the AI prompt. MangaUpdates first
 * (highest signal), then AniList, MAL, Kitsu, ComicK, AnimePlanet, MangaDex.
 */
const REVIEW_SOURCE_PRIORITY: Record<ExternalSourceId, number> = {
  mangaupdates: 0,
  anilist: 1,
  myanimelist: 2,
  kitsu: 3,
  comick: 4,
  animeplanet: 5,
  mangadex: 6,
  comix: 7,
}

/**
 * Fetches user reviews from every source that has an id on the merged candidate.
 * MangaUpdates is prioritized. Cap of 4 per source, 12 total. ComicK reviews
 * not yet implemented (Sprint Tranche 2).
 */
async function fetchReviewsFromCandidate(candidate: MergedCandidate): Promise<SourcedReview[]> {
  const fetchers: Array<Promise<{ source: ExternalSourceId; reviews: string[] } | null>> = [
    candidate.muId
      ? fetchMangaUpdatesReviews(candidate.muId).then((reviews) => ({ source: "mangaupdates" as const, reviews }))
      : Promise.resolve(null),
    candidate.anilistId
      ? fetchAniListReviews(candidate.anilistId).then((reviews) => ({ source: "anilist" as const, reviews }))
      : Promise.resolve(null),
    candidate.malId
      ? fetchJikanMangaReviews(candidate.malId).then((reviews) => ({ source: "myanimelist" as const, reviews }))
      : Promise.resolve(null),
    candidate.kitsuId
      ? fetchKitsuReactions(candidate.kitsuId).then((reviews) => ({ source: "kitsu" as const, reviews }))
      : Promise.resolve(null),
  ]

  const settled = await Promise.allSettled(fetchers)

  return settled
    .flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []))
    .flatMap((group) =>
      group.reviews
        .filter((text) => text.trim().length >= 100)
        .slice(0, 4)
        .map((text): SourcedReview => ({
          source: group.source,
          sourceTitle: candidate.title,
          matchScore: candidate.matchScore ?? 1,
          text,
        }))
    )
    .sort((a, b) => {
      const pa = REVIEW_SOURCE_PRIORITY[a.source] ?? 99
      const pb = REVIEW_SOURCE_PRIORITY[b.source] ?? 99
      if (pa !== pb) return pa - pb
      return (b.matchScore ?? 0) - (a.matchScore ?? 0)
    })
    .slice(0, 12)
}

/**
 * Public entrypoint used by the AI evaluation flow ([server/actions/ai.ts]) to
 * gather user reviews + supplemental synopses for the work being scored.
 *
 * Walks title variants (oficial → original → alternativos), runs the unified
 * [searchAllSources], picks the best candidate above similarity threshold,
 * hydrates it across all sources, and collects:
 *  - sourcedReviews: from MU/AniList/MAL/Kitsu (MU first), max 12.
 *  - externalContext: deduped synopsis blocks from accepted source bodies, max 6.
 */
export async function fetchExternalEvaluationContextForWork(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
}): Promise<{ sourcedReviews: SourcedReview[]; externalContext: string[] }> {
  const queries = uniqueStrings([
    input.title,
    input.originalTitle,
    ...(input.alternativeTitles ?? []),
  ]).slice(0, 5)

  for (const query of queries) {
    const candidates = await searchAllSources(query)
    for (const candidate of candidates) {
      if ((candidate.matchScore ?? 0) < 0.72) break // candidates are sorted desc; no point continuing
      const [{ hydrated }, sourcedReviews] = await Promise.all([
        hydrateCandidate(candidate),
        fetchReviewsFromCandidate(candidate),
      ])
      const externalContext = uniqueSynopsisBlocks(hydrated.map((h) => h.synopsis)).slice(0, 6)
      if (sourcedReviews.length || externalContext.length) {
        return { sourcedReviews, externalContext }
      }
    }
  }

  return { sourcedReviews: [], externalContext: [] }
}

// ============================================================================
// Hydration
// ============================================================================

async function hydrateCandidate(candidate: MergedCandidate): Promise<{ hydrated: ExternalSearchResult[]; apDetail: AnimePlanetDetail | null }> {
  const base = candidate.sourceResults ?? []
  const settled = await Promise.allSettled([
    candidate.anilistId ? fetchAniListById(candidate.anilistId) : null,
    candidate.muId ? fetchMangaUpdatesById(candidate.muId) : null,
    candidate.kitsuId ? fetchKitsuMangaById(candidate.kitsuId) : null,
    candidate.malId ? fetchJikanMangaById(candidate.malId) : null,
    candidate.mangadexId ? fetchMangaDexById(candidate.mangadexId) : null,
    candidate.comickHid ? fetchComicKByHid(candidate.comickHid) : null,
    candidate.comixHid ? fetchComixById(candidate.comixHid) : null,
    candidate.animePlanetSlug ? fetchAnimePlanetByTitle(candidate.title, candidate.animePlanetSlug) : null,
  ])

  const HYDRATE_SOURCES = ["anilist", "mangaupdates", "kitsu", "myanimelist", "mangadex", "comick", "comix", "animeplanet"] as const
  settled.forEach((entry, i) => {
    if (entry.status === "rejected") {
      console.error(
        `[hydrateCandidate] ${HYDRATE_SOURCES[i]} failed for candidate="${candidate.title}"`,
        entry.reason instanceof Error ? entry.reason.message : entry.reason
      )
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ani, mu, kitsu, mal, md, cmx, cmix, ap] = settled.map((entry) => entry.status === "fulfilled" ? entry.value : null) as Array<Record<string, any> | null>
  const hydrated: ExternalSearchResult[] = [...base]
  if (ani) hydrated.push({ id: `anilist:${candidate.anilistId}`, source: "anilist", title: ani.title, originalTitle: ani.originalTitle, alternativeTitles: ani.alternativeTitles, synopsis: ani.synopsis, coverUrl: ani.coverUrl, year: ani.year, yearEnd: ani.yearEnd, publicationStatus: ani.status, chapters: ani.chapters, score: ani.score, votes: ani.votes, genres: ani.genres })
  if (mu) hydrated.push({ id: `mu:${candidate.muId}`, source: "mangaupdates", title: mu.title, alternativeTitles: mu.alternativeTitles, synopsis: mu.synopsis, coverUrl: mu.coverUrl, year: mu.year, publicationStatus: mu.publicationStatus, chapters: mu.chapters, score: mu.rating, votes: mu.votes, genres: uniqueStrings([...(mu.genres ?? []), ...(mu.categories ?? [])]) })
  if (kitsu) hydrated.push({ id: `kitsu:${candidate.kitsuId}`, source: "kitsu", title: kitsu.title, synopsis: kitsu.synopsis, coverUrl: kitsu.coverUrl, year: kitsu.year, publicationStatus: kitsu.publicationStatus, chapters: kitsu.chapters, score: kitsu.rating, votes: kitsu.votes, genres: kitsu.genres })
  if (mal) hydrated.push({ id: `mal:${candidate.malId}`, source: "myanimelist", title: mal.title, originalTitle: mal.originalTitle, alternativeTitles: mal.alternativeTitles, synopsis: mal.synopsis, coverUrl: mal.coverUrl, year: mal.year, publicationStatus: mal.publicationStatus, chapters: mal.chapters, score: mal.rating, votes: mal.votes, genres: mal.genres })
  if (md) hydrated.push({ id: `mangadex:${candidate.mangadexId}`, source: "mangadex", title: md.title, alternativeTitles: md.alternativeTitles, synopsis: md.synopsis, coverUrl: md.coverUrl, year: md.year, publicationStatus: md.publicationStatus, chapters: md.chapters, score: md.rating, votes: md.votes, genres: md.genres })
  if (cmx) hydrated.push({ id: `comick:${candidate.comickHid}`, source: "comick", title: cmx.title, alternativeTitles: cmx.alternativeTitles, synopsis: cmx.synopsis, coverUrl: cmx.coverUrl, publicationStatus: cmx.publicationStatus, chapters: cmx.lastChapter, score: cmx.rating, votes: cmx.votes, genres: cmx.tags })
  if (cmix) hydrated.push({ id: `comix:${candidate.comixHid}`, source: "comix", title: cmix.title, alternativeTitles: cmix.alternativeTitles, synopsis: cmix.synopsis, coverUrl: cmix.coverUrl, year: cmix.year, publicationStatus: cmix.publicationStatus, chapters: cmix.chapters, score: cmix.rating, votes: cmix.votes, genres: cmix.tags })
  return { hydrated, apDetail: ap as AnimePlanetDetail | null }
}

// ============================================================================
// Merge into ExternalWorkData + conflict detection (Fase 2)
// ============================================================================

/**
 * Per-source order applied to multiCovers / multiSynopses returned to the form.
 * The first element of the resulting array is selected by the UI as primary.
 */
const METADATA_SOURCE_PRIORITY: Record<ExternalSourceId, number> = {
  mangaupdates: 0,
  anilist: 1,
  myanimelist: 2,
  kitsu: 3,
  comick: 4,
  animeplanet: 5,
  mangadex: 6,
  comix: 7,
}

function bySourcePriority<T extends { source: ExternalSourceId }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (METADATA_SOURCE_PRIORITY[a.source] ?? 99) - (METADATA_SOURCE_PRIORITY[b.source] ?? 99)
  )
}

function mergeData(candidate: MergedCandidate, accepted: ExternalSearchResult[], apDetail?: AnimePlanetDetail | null): ExternalWorkData {
  const primary = accepted[0] ?? candidate
  const synopsisInputs: Array<{ source: ExternalSourceId; text: string | null | undefined }> = accepted.map(
    (result) => ({ source: result.source, text: result.synopsis })
  )
  if (apDetail?.synopsis) {
    synopsisInputs.push({ source: "animeplanet", text: apDetail.synopsis })
  }
  const synopses = uniqueSynopsisBlocks(synopsisInputs.map((entry) => entry.text))
  const multiSynopses = bySourcePriority(uniqueSynopsisBlocksWithSource(synopsisInputs))

  const multiCoversRaw: Array<{ url: string; source: ExternalSourceId }> = []
  const seenCoverUrls = new Set<string>()
  for (const result of accepted) {
    if (!result.coverUrl) continue
    if (seenCoverUrls.has(result.coverUrl)) continue
    seenCoverUrls.add(result.coverUrl)
    multiCoversRaw.push({ url: result.coverUrl, source: result.source })
  }
  // AnimePlanet flows through apDetail (separate from accepted) — surface its cover here.
  if (apDetail?.coverUrl && !seenCoverUrls.has(apDetail.coverUrl)) {
    seenCoverUrls.add(apDetail.coverUrl)
    multiCoversRaw.push({ url: apDetail.coverUrl, source: "animeplanet" })
  }
  const multiCovers = bySourcePriority(multiCoversRaw)

  const ratings = accepted.flatMap((result) => result.score != null || result.votes != null
    ? [{ platform: result.source, rating: result.score ?? null, votes: result.votes ?? null }]
    : [])
  const apEntry = apDetail?.rating != null || apDetail?.votes != null
    ? [{ platform: "animeplanet" as const, rating: apDetail.rating ?? null, votes: apDetail.votes ?? null }]
    : []

  return {
    title: primary.title,
    originalTitle: primary.originalTitle ?? candidate.originalTitle,
    alternativeTitles: uniqueStrings([
      candidate.originalTitle,
      ...(candidate.alternativeTitles ?? []),
      ...accepted.flatMap((result) => [result.originalTitle, ...(result.alternativeTitles ?? [])]),
    ]),
    synopsis: multiSynopses[0]?.text ?? synopses[0] ?? cleanSynopsisPre(candidate.synopsis),
    synopsisIsMerged: multiSynopses.length > 1,
    multiSynopses,
    coverUrl: multiCovers[0]?.url ?? candidate.coverUrl,
    multiCovers,
    year: accepted.find((result) => result.year)?.year ?? candidate.year,
    yearEnd: accepted.find((result) => result.yearEnd)?.yearEnd ?? candidate.yearEnd,
    publicationStatus: accepted.find((result) => result.publicationStatus)?.publicationStatus ?? candidate.publicationStatus,
    totalChapters: accepted.find((result) => result.chapters != null)?.chapters ?? candidate.chapters,
    genres: uniqueStrings(accepted.flatMap((result) => result.genres ?? [])),
    tags: [],
    muRating: ratings.find((r) => r.platform === "mangaupdates")?.rating ?? undefined,
    muVotes: ratings.find((r) => r.platform === "mangaupdates")?.votes ?? undefined,
    cmxRating: ratings.find((r) => r.platform === "comick")?.rating ?? undefined,
    cmxVotes: ratings.find((r) => r.platform === "comick")?.votes ?? undefined,
    apRating: apDetail?.rating ?? undefined,
    apVotes: apDetail?.votes ?? undefined,
    externalPlatformRatings: [...ratings, ...apEntry],
  }
}

const PUBLICATION_STATUS_LABELS: Record<string, string> = {
  C: "Completo",
  O: "Em andamento",
  H: "Hiatus",
  Cancelled: "Cancelado",
  Completed: "Completo",
  Ongoing: "Em andamento",
  Hiatus: "Hiatus",
  Unknown: "Desconhecido",
}

function formatStatus(value: unknown): string {
  if (typeof value !== "string") return String(value)
  return PUBLICATION_STATUS_LABELS[value] ?? value
}

/**
 * Builds a ConflictField when accepted sources disagree on a given attribute.
 * Returns null when 0 or 1 distinct value exists (no conflict).
 */
function detectConflict<K extends keyof ExternalSearchResult>(
  field: K,
  workField: keyof ExternalWorkData,
  label: string,
  accepted: ExternalSearchResult[],
  format: (value: NonNullable<ExternalSearchResult[K]>) => string = (v) => String(v),
): ConflictField | null {
  const byValue = new Map<string, ConflictOption>()
  for (const result of accepted) {
    const raw = result[field]
    if (raw == null || raw === "") continue
    const key = String(raw)
    if (byValue.has(key)) continue
    byValue.set(key, {
      source: result.source,
      displayValue: format(raw as NonNullable<ExternalSearchResult[K]>),
      value: raw,
    })
  }
  if (byValue.size < 2) return null
  return {
    field: workField,
    label,
    options: bySourcePriority([...byValue.values()] as Array<ConflictOption & { source: ExternalSourceId }>),
  }
}

// ============================================================================
// Public: full multi-source detail fetch
// ============================================================================

export async function fetchMultiSourceDetails(candidate: MergedCandidate): Promise<MultiSourceResult> {
  const { hydrated, apDetail } = await hydrateCandidate(candidate)
  const accepted: ExternalSearchResult[] = []
  const rejected: Array<{ result: ExternalSearchResult; reason?: string }> = []
  for (const result of hydrated) {
    const { titleScore, synScore, composite, reason } = compositeAcceptScore(candidate, result)
    const passes = titleScore >= 0.62 && synScore >= 0.18 && composite >= 0.55
    if (passes) accepted.push({ ...result, score: result.score })
    else rejected.push({ result, reason })
  }

  const uniqueAccepted = Array.from(new Map(accepted.map((result) => [result.id, result])).values())
    .sort((a, b) => {
      if (a.source === "mangaupdates") return -1
      if (b.source === "mangaupdates") return 1
      return 0
    })
  const reviews = candidate.muId ? await fetchMangaUpdatesReviews(candidate.muId) : []
  const data = mergeData(candidate, uniqueAccepted, apDetail)

  const conflicts: ConflictField[] = []
  const chaptersConflict = detectConflict("chapters", "totalChapters", "Total de capítulos", uniqueAccepted)
  if (chaptersConflict) conflicts.push(chaptersConflict)
  const statusConflict = detectConflict("publicationStatus", "publicationStatus", "Status de publicação", uniqueAccepted, formatStatus)
  if (statusConflict) conflicts.push(statusConflict)
  const yearConflict = detectConflict("year", "year", "Ano de início", uniqueAccepted)
  if (yearConflict) conflicts.push(yearConflict)
  const yearEndConflict = detectConflict("yearEnd", "yearEnd", "Ano de fim", uniqueAccepted)
  if (yearEndConflict) conflicts.push(yearEndConflict)

  const debug: ExternalMergeDebug = {
    queryTitle: candidate.title,
    acceptedSources: uniqueAccepted.map((result) => ({ ...sourceDebug(result, true), reviews: result.source === "mangaupdates" ? reviews : [] })),
    rejectedSources: rejected.map(({ result, reason }) => sourceDebug(result, false, reason ?? "Título/sinopse não bateram com o candidato principal")),
    mergedSynopses: uniqueAccepted.flatMap((result) =>
      splitSynopsisBlocks(result.synopsis).map((text) => ({ source: result.source as ExternalSourceId, text }))
    ),
  }
  data.debug = debug

  return { data, conflicts, debug }
}
