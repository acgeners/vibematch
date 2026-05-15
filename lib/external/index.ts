import { searchAniList, fetchAniListById, fetchAniListReviews } from "./anilist"
import { searchAnimePlanet, fetchAnimePlanetByTitle, fetchAnimePlanetReviews } from "./animeplanet"
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

  // Candidato contém a query inteira → score alto.
  if (nb.includes(na)) return 0.9

  // Query contém o candidato (reverse substring) — situação onde mais falsos
  // positivos acontecem. Ex.: buscar "The Fake Lady and Her Rabbit Duke" e
  // encontrar "Fake Lady" (obra completamente diferente). Gradua o score pela
  // proporção do candidato dentro da query + palavras significativas.
  if (na.includes(nb)) {
    const ratio = nb.length / na.length
    const shortWords = nb.split(" ").filter((w) => w.length > 2).length
    if (ratio >= 0.6 || shortWords >= 4) return 0.9 // substring substancial
    if (ratio >= 0.4 || shortWords >= 3) return 0.75 // palavras significativas
    if (ratio >= 0.25 && shortWords >= 2) return 0.65 // marginal — passa só se outras evidências ajudarem
    // Caso contrário cai pro Jaccard abaixo (provável rejeição pelo threshold)
  }

  const aw = new Set(na.split(" ").filter((w) => w.length > 2))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return 0
  const intersection = [...aw].filter((word) => bw.has(word)).length
  return intersection / new Set([...aw, ...bw]).size
}

export function bestTitleMatch(query: string, result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">) {
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
  if (titleScore < 0.72) reason = `título não bate (score=${titleScore.toFixed(2)})`
  else if (synScore < 0.18) reason = `sinopse divergente (score=${synScore.toFixed(2)})`
  else if (composite < 0.62) reason = `score composto baixo (${composite.toFixed(2)})`
  else if (chapterPenalty > 0) reason = `divergência forte de capítulos (penalidade aplicada)`

  return { titleScore, synScore, composite, reason: composite < 0.62 || titleScore < 0.72 || synScore < 0.18 ? reason : undefined }
}

// ============================================================================
// Synopsis cleanup
// ============================================================================

function cleanSynopsisPre(text: string | null | undefined): string {
  if (!text) return ""

  // Detecta marcadores de classificação ANTES da limpeza pra não perdê-los.
  // Aparecem em vários contextos ("Original Webtoon: R19", "Official
  // Translations (R19)", "R19 only", etc) e a maioria é removida pelas regras
  // de boilerplate abaixo. Reinjetamos no fim se foram apagados.
  const detectedRatings: string[] = []
  if (/\bR\s*-?\s*19\b/i.test(text)) detectedRatings.push("R19")
  if (/\bR\s*-?\s*18\b/i.test(text)) detectedRatings.push("R18")

  let cleaned = text
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

  // Reinjeta marcadores ausentes — garante sinal pra enforceR19AdultContentRule
  // e pra IA mesmo quando o bloco "Original Webtoon"/"Official Translations" foi
  // removido pela limpeza.
  for (const marker of detectedRatings) {
    const re = new RegExp(`\\b${marker}\\b`, "i")
    if (!re.test(cleaned)) {
      cleaned = cleaned
        ? `${cleaned}\n\n[${marker} disponível]`
        : `[${marker} disponível]`
    }
  }
  return cleaned
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

const EXCLUDED_TITLE_SUFFIXES = /\s*\((novel|promo|promotion|pre-serialization|preserialization|prequel|doujin|doujinshi|oneshot|one-shot)\)\s*$/i

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
    .filter(({ matchScore }) => matchScore >= 0.65)
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

export const SEARCH_CONNECTORS = [
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
      return results.map((item): ExternalSearchResult => {
        const crossIds: Partial<Record<ExternalSourceId, string>> = {}
        if (item.links?.al) crossIds.anilist = item.links.al
        if (item.links?.mu) crossIds.mangaupdates = item.links.mu
        if (item.links?.mal) crossIds.myanimelist = item.links.mal
        if (item.links?.kt) crossIds.kitsu = item.links.kt
        if (item.links?.ap) crossIds.animeplanet = item.links.ap
        return {
          id: `mangadex:${item.id}`,
          source: "mangadex",
          title: item.title,
          alternativeTitles: item.alternativeTitles,
          synopsis: item.synopsis,
          coverUrl: item.coverUrl,
          year: item.year,
          chapters: item.chapters,
          crossIds: Object.keys(crossIds).length > 0 ? crossIds : undefined,
        }
      })
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
  const merged = mergeSearchResults(query, results)
  hoistCrossSourceIds(merged)
  const refined = await refineWithAlternativeTitles(merged, query)
  hoistCrossSourceIds(refined)
  return refined
}

// ============================================================================
// Cross-source ID hoisting
// ============================================================================

/**
 * Some sources surface IDs of sibling platforms in their search payload
 * (MangaDex `attributes.links` exposes AniList/MU/MAL/Kitsu/AnimePlanet IDs;
 * AniList GraphQL exposes `idMal`). When a sibling source didn't appear in the
 * first-pass merge because its title differs strongly from the user's query,
 * we still want it represented on the candidate — fetchMultiSourceDetails will
 * use the populated ID to hydrate via `hydrateCandidate`, bypassing title
 * search entirely.
 */
function hoistCrossSourceIds(candidates: MergedCandidate[]): void {
  for (const candidate of candidates) {
    const trust = (source: ExternalSourceId) => {
      if (!candidate.trustedSources) candidate.trustedSources = []
      if (!candidate.trustedSources.includes(source)) candidate.trustedSources.push(source)
    }
    for (const result of candidate.sourceResults ?? []) {
      const cross = result.crossIds
      if (!cross) continue
      if (cross.anilist && candidate.anilistId == null) {
        const n = Number(cross.anilist)
        if (Number.isFinite(n)) {
          candidate.anilistId = n
          if (!candidate.sources.includes("anilist")) candidate.sources = [...candidate.sources, "anilist"]
          trust("anilist")
        }
      }
      if (cross.mangaupdates && candidate.muId == null) {
        const n = Number(cross.mangaupdates)
        if (Number.isFinite(n)) {
          candidate.muId = n
          if (!candidate.sources.includes("mangaupdates")) candidate.sources = [...candidate.sources, "mangaupdates"]
          trust("mangaupdates")
        }
      }
      if (cross.myanimelist && candidate.malId == null) {
        const n = Number(cross.myanimelist)
        if (Number.isFinite(n)) {
          candidate.malId = n
          if (!candidate.sources.includes("myanimelist")) candidate.sources = [...candidate.sources, "myanimelist"]
          trust("myanimelist")
        }
      }
      if (cross.kitsu && !candidate.kitsuId) {
        candidate.kitsuId = cross.kitsu
        if (!candidate.sources.includes("kitsu")) candidate.sources = [...candidate.sources, "kitsu"]
        trust("kitsu")
      }
      if (cross.animeplanet && !candidate.animePlanetSlug) {
        candidate.animePlanetSlug = cross.animeplanet
        if (!candidate.sources.includes("animeplanet")) candidate.sources = [...candidate.sources, "animeplanet"]
        trust("animeplanet")
      }
      if (cross.mangadex && !candidate.mangadexId) {
        candidate.mangadexId = cross.mangadex
        if (!candidate.sources.includes("mangadex")) candidate.sources = [...candidate.sources, "mangadex"]
        trust("mangadex")
      }
      if (cross.comick && !candidate.comickHid) {
        candidate.comickHid = cross.comick
        if (!candidate.sources.includes("comick")) candidate.sources = [...candidate.sources, "comick"]
        trust("comick")
      }
      if (cross.comix && !candidate.comixHid) {
        candidate.comixHid = cross.comix
        if (!candidate.sources.includes("comix")) candidate.sources = [...candidate.sources, "comix"]
        trust("comix")
      }
    }
  }
}

// ============================================================================
// Refine: backfill missing sources using a candidate's alternative titles
// ============================================================================

/**
 * Second-pass search: for each top candidate, re-query the platforms that
 * didn't return a result on the original query, this time using the candidate's
 * own alternative titles (mostly discovered via MangaUpdates `associated`,
 * Kitsu `titles/abbreviatedTitles`, MangaDex altTitles, Jikan). This makes the
 * final source list independent of which title variant the user typed in.
 *
 * Acceptance uses the same `compositeAcceptScore` thresholds as the hydrate
 * stage (titleScore ≥ 0.72, synScore ≥ 0.18, composite ≥ 0.62) so we don't
 * pollute a candidate with results from same-named-but-different works.
 */
function fillCandidateIdFromResult(candidate: MergedCandidate, result: ExternalSearchResult) {
  const idPart = sourceId(result)
  switch (result.source) {
    case "anilist":
      if (candidate.anilistId == null && idPart) candidate.anilistId = Number(idPart)
      break
    case "mangaupdates":
      if (candidate.muId == null && idPart) candidate.muId = Number(idPart)
      break
    case "kitsu":
      if (!candidate.kitsuId && idPart) candidate.kitsuId = idPart
      break
    case "mangadex":
      if (!candidate.mangadexId && idPart) candidate.mangadexId = idPart
      break
    case "myanimelist":
      if (candidate.malId == null && idPart) candidate.malId = Number(idPart)
      break
    case "comick":
      if (!candidate.comickHid && idPart) candidate.comickHid = idPart
      break
    case "comix":
      if (!candidate.comixHid && idPart) candidate.comixHid = idPart
      break
    case "animeplanet":
      if (!candidate.animePlanetSlug && idPart) candidate.animePlanetSlug = idPart
      break
  }
}

async function refineWithAlternativeTitles(
  candidates: MergedCandidate[],
  originalQuery: string,
  maxCandidates = 3,
  maxVariantsPerCandidate = 4,
): Promise<MergedCandidate[]> {
  const normalizedOriginal = normalizeText(originalQuery)
  const slice = candidates.slice(0, maxCandidates)

  await Promise.all(slice.map(async (candidate) => {
    const missingConnectors = SEARCH_CONNECTORS.filter((c) => !candidate.sources.includes(c.source))
    if (missingConnectors.length === 0) return

    const variants = uniqueStrings([
      candidate.title,
      candidate.originalTitle,
      ...(candidate.alternativeTitles ?? []),
    ])
      .filter((v) => normalizeText(v) !== normalizedOriginal)
      .filter((v) => v.replace(/[^\p{L}\p{N}]/gu, "").length >= 3)
      .slice(0, maxVariantsPerCandidate)

    if (variants.length === 0) return

    await Promise.all(missingConnectors.map(async (connector) => {
      const settled = await Promise.allSettled(variants.map((v) => connector.search(v)))
      const flatResults = settled.flatMap((entry, i) => {
        if (entry.status === "fulfilled") return entry.value.map((result) => ({ result, variant: variants[i] }))
        console.error(
          `[searchAllSources] refine connector=${connector.source} variant="${variants[i]}" failed`,
          entry.reason instanceof Error ? entry.reason.message : entry.reason
        )
        return []
      })

      const candidateNames = [candidate.title, candidate.originalTitle, ...(candidate.alternativeTitles ?? [])]
      const accepted = flatResults
        .map(({ result, variant }) => {
          if (isExcludedResult(result)) return null
          const titleScore = Math.max(
            ...candidateNames.map((name) => (name ? bestTitleMatch(name, result) : 0)),
            0
          )
          const score = compositeAcceptScore(candidate, result)
          // Aceita se a fórmula completa passar OU se o título bater forte com alguma
          // variante conhecida do candidato (≥ 0.78). A segunda condição cobre fontes
          // como AnimePlanet, cuja busca não devolve `alternativeTitles` e cuja sinopse
          // pode divergir do candidato — fetchMultiSourceDetails revalida depois.
          const passes = score.reason === undefined || titleScore >= 0.78
          if (!passes) return null
          return { result, variant, composite: score.composite, titleScore }
        })
        .filter((entry): entry is { result: ExternalSearchResult; variant: string; composite: number; titleScore: number } => entry !== null)
        .sort((a, b) => (b.titleScore - a.titleScore) || (b.composite - a.composite))

      if (accepted.length === 0) {
        console.log(
          `[searchAllSources] refine source=${connector.source}: ${flatResults.length} results, 0 accepted for candidate="${candidate.title}"`
        )
        return
      }
      const best = accepted[0]

      if (candidate.sourceResults?.some((r) => r.id === best.result.id)) return

      candidate.sources = [...new Set([...candidate.sources, connector.source])]
      candidate.sourceResults = [...(candidate.sourceResults ?? []), best.result]
      candidate.alternativeTitles = uniqueStrings([
        ...(candidate.alternativeTitles ?? []),
        best.result.originalTitle,
        ...(best.result.alternativeTitles ?? []),
      ])
      candidate.genres = uniqueStrings([...(candidate.genres ?? []), ...(best.result.genres ?? [])])
      fillCandidateIdFromResult(candidate, best.result)

      console.log(
        `[searchAllSources] refine added source=${connector.source} via variant="${best.variant}" to candidate="${candidate.title}" (title=${best.titleScore.toFixed(2)} composite=${best.composite.toFixed(2)})`
      )
    }))
  }))

  return candidates
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
  animeplanet: 3,
  kitsu: 4,
  comick: 5,
  mangadex: 6,
  comix: 7,
}

/**
 * Extrai a nota numérica embutida pelos fetchers de MangaUpdates e MAL/Jikan,
 * que prefixam o texto com "Nota do usuário: X/10\n". Devolve o rating e o
 * texto sem esse prefixo (para não duplicar no prompt). Quando o prefixo não
 * existe, devolve `{ cleanText: text }` sem rating.
 */
export function extractUserRating(text: string): { rating?: number; cleanText: string } {
  const match = text.match(/^\s*Nota do usu[áa]rio:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*10)?\s*\n+/i)
  if (!match) return { cleanText: text }
  const raw = Number(match[1])
  if (!Number.isFinite(raw) || raw < 0 || raw > 10) {
    return { cleanText: text.slice(match[0].length) }
  }
  return { rating: raw, cleanText: text.slice(match[0].length) }
}

/**
 * Fetches user reviews from every source that has an id on the merged candidate.
 * Não aplica cap — devolve tudo. A seleção/limites são feitos por
 * `selectReviewsForEvaluation()`. ComicK reviews ainda não implementadas.
 */
async function collectReviewsFromCandidate(candidate: MergedCandidate): Promise<SourcedReview[]> {
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
    candidate.animePlanetSlug
      ? fetchAnimePlanetReviews(candidate.animePlanetSlug).then((reviews) => ({ source: "animeplanet" as const, reviews }))
      : Promise.resolve(null),
  ]

  const settled = await Promise.allSettled(fetchers)

  return settled
    .flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []))
    .flatMap((group) =>
      group.reviews
        .filter((text) => text.trim().length >= 100)
        .map((text): SourcedReview => {
          const { rating, cleanText } = extractUserRating(text)
          return {
            source: group.source,
            sourceTitle: candidate.title,
            matchScore: candidate.matchScore ?? 1,
            text: cleanText,
            userRating: rating,
            textLength: cleanText.length,
          }
        })
    )
}

/**
 * Seleciona reviews para enviar à IA com amostragem estratificada por fonte
 * e por sentimento. Algoritmo:
 *  1. Agrupa por `source`.
 *  2. Em cada grupo, se há ratings, bucketiza alto (>=7) / baixo (<=4) / médio
 *     e pega round-robin entre buckets (ordenado por textLength desc).
 *     Sem ratings, ordena por textLength desc.
 *  3. Round-robin global entre fontes (ordem REVIEW_SOURCE_PRIORITY) até `total`.
 *
 * Garante diversidade de opinião e de fonte sem precisar de embeddings.
 */
export function selectReviewsForEvaluation(
  reviews: SourcedReview[],
  opts: { perSource: number; total: number }
): SourcedReview[] {
  const grouped = new Map<ExternalSourceId, SourcedReview[]>()
  for (const review of reviews) {
    const list = grouped.get(review.source)
    if (list) list.push(review)
    else grouped.set(review.source, [review])
  }

  const byLength = (a: SourcedReview, b: SourcedReview) =>
    (b.textLength ?? b.text.length) - (a.textLength ?? a.text.length)

  function pickFromSource(items: SourcedReview[], perSource: number): SourcedReview[] {
    if (items.length <= perSource) return [...items].sort(byLength)
    const withRating = items.filter((r) => typeof r.userRating === "number")
    if (withRating.length < 2) {
      return [...items].sort(byLength).slice(0, perSource)
    }
    const high = withRating.filter((r) => (r.userRating ?? 0) >= 7).sort(byLength)
    const low = withRating.filter((r) => (r.userRating ?? 0) <= 4).sort(byLength)
    const mid = withRating
      .filter((r) => (r.userRating ?? 0) > 4 && (r.userRating ?? 0) < 7)
      .sort(byLength)
    const noRating = items.filter((r) => typeof r.userRating !== "number").sort(byLength)
    const buckets = [high, low, mid, noRating].filter((b) => b.length > 0)
    const picked: SourcedReview[] = []
    const cursors = buckets.map(() => 0)
    while (picked.length < perSource) {
      let progressed = false
      for (let i = 0; i < buckets.length && picked.length < perSource; i++) {
        if (cursors[i] < buckets[i].length) {
          picked.push(buckets[i][cursors[i]])
          cursors[i]++
          progressed = true
        }
      }
      if (!progressed) break
    }
    return picked
  }

  const perSourcePicked = new Map<ExternalSourceId, SourcedReview[]>()
  for (const [source, list] of grouped.entries()) {
    perSourcePicked.set(source, pickFromSource(list, opts.perSource))
  }

  const sortedSources = [...perSourcePicked.keys()].sort((a, b) => {
    const pa = REVIEW_SOURCE_PRIORITY[a] ?? 99
    const pb = REVIEW_SOURCE_PRIORITY[b] ?? 99
    return pa - pb
  })

  const result: SourcedReview[] = []
  const sourceCursors = new Map<ExternalSourceId, number>(sortedSources.map((s) => [s, 0]))
  while (result.length < opts.total) {
    let progressed = false
    for (const source of sortedSources) {
      if (result.length >= opts.total) break
      const list = perSourcePicked.get(source) ?? []
      const cursor = sourceCursors.get(source) ?? 0
      if (cursor < list.length) {
        result.push(list[cursor])
        sourceCursors.set(source, cursor + 1)
        progressed = true
      }
    }
    if (!progressed) break
  }
  return result
}

/**
 * Public entrypoint used by the AI evaluation flow ([server/actions/ai.ts]) to
 * gather user reviews + supplemental synopses for the work being scored.
 *
 * Walks title variants (oficial → original → alternativos), runs the unified
 * [searchAllSources], picks the best candidate above similarity threshold,
 * hydrates it across all sources, and collects:
 *  - sourcedReviews: até 20 reviews de MU/AniList/MAL/AnimePlanet/Kitsu via
 *    amostragem estratificada (positivo + médio + negativo por fonte quando há
 *    rating; fallback por tamanho), cap 6 por fonte.
 *  - externalContext: deduped synopsis blocks from accepted source bodies, max 6.
 */
export async function fetchExternalEvaluationContextForWork(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
  /**
   * Fontes explicitamente rejeitadas pelo usuário via "Revalidar fontes"
   * (work_external_ids.is_rejected). Reviews/synopses dessas fontes são
   * filtradas após a coleta — evita propagação de matches errados.
   */
  rejectedSources?: ReadonlyArray<string>
}): Promise<{ sourcedReviews: SourcedReview[]; externalContext: string[] }> {
  const queries = uniqueStrings([
    input.title,
    input.originalTitle,
    ...(input.alternativeTitles ?? []),
  ]).slice(0, 5)

  const rejected = new Set((input.rejectedSources ?? []) as string[])

  for (const query of queries) {
    const candidates = await searchAllSources(query)
    for (const candidate of candidates) {
      if ((candidate.matchScore ?? 0) < 0.72) break // candidates are sorted desc; no point continuing
      const [{ hydrated }, allReviews] = await Promise.all([
        hydrateCandidate(candidate),
        collectReviewsFromCandidate(candidate),
      ])
      const filteredReviews = rejected.size > 0
        ? allReviews.filter((r) => !rejected.has(r.source))
        : allReviews
      const filteredHydrated = rejected.size > 0
        ? hydrated.filter((h: ExternalSearchResult) => !rejected.has(h.source))
        : hydrated
      const sourcedReviews = selectReviewsForEvaluation(filteredReviews, { perSource: 6, total: 20 })
      const externalContext = uniqueSynopsisBlocks(
        filteredHydrated.map((h: ExternalSearchResult) => h.synopsis)
      ).slice(0, 6)
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
  const trustedSet = new Set(candidate.trustedSources ?? [])
  for (const result of hydrated) {
    const { titleScore, synScore, composite, reason } = compositeAcceptScore(candidate, result)
    const passes = titleScore >= 0.72 && synScore >= 0.18 && composite >= 0.62
    if (passes || trustedSet.has(result.source)) accepted.push({ ...result, score: result.score })
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

  // Persist external IDs only for sources that passed the acceptance threshold,
  // so future "Atualizar dados" refreshes can rehydrate without title search.
  const candidateIds: Partial<Record<ExternalSourceId, string>> = {
    anilist: candidate.anilistId != null ? String(candidate.anilistId) : undefined,
    mangaupdates: candidate.muId != null ? String(candidate.muId) : undefined,
    myanimelist: candidate.malId != null ? String(candidate.malId) : undefined,
    kitsu: candidate.kitsuId,
    mangadex: candidate.mangadexId,
    comick: candidate.comickHid,
    comix: candidate.comixHid,
    animeplanet: candidate.animePlanetSlug,
  }
  const acceptedSources = new Set(uniqueAccepted.map((r) => r.source))
  const externalIds: Partial<Record<ExternalSourceId, string>> = {}
  for (const [source, id] of Object.entries(candidateIds) as Array<[ExternalSourceId, string | undefined]>) {
    if (id && acceptedSources.has(source)) externalIds[source] = id
  }
  if (Object.keys(externalIds).length > 0) data.externalIds = externalIds

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
