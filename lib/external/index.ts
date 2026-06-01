import { searchAniList, fetchAniListById, fetchAniListReviews, fetchAniListRecommendations } from "./anilist"
import { searchAnimePlanet, fetchAnimePlanetByTitle, fetchAnimePlanetReviews, fetchAnimePlanetRecommendations } from "./animeplanet"
import type { AnimePlanetDetail } from "./animeplanet"
import { searchComicK, fetchComicKByHid } from "./comick"
import { searchComix, fetchComixById } from "./comix"
import { isBlockedCoverUrl } from "./blocked-covers"
import { searchJikanManga, fetchJikanMangaById, fetchJikanMangaReviews, fetchJikanMangaRecommendations } from "./jikan"
import { searchKitsuManga, fetchKitsuMangaById, fetchKitsuReactions } from "./kitsu"
import { searchMangaDex, fetchMangaDexById, fetchMangaDexForumComments } from "./mangadex"
import { searchMangaUpdates, fetchMangaUpdatesById, fetchMangaUpdatesReviews, fetchMangaUpdatesAlternativeTitles } from "./mangaupdates"
import type {
  ConflictField,
  ConflictOption,
  ExternalMergeDebug,
  ExternalSearchResult,
  ExternalSourceCandidateOption,
  ExternalSourceDebug,
  ExternalSourceId,
  ExternalWorkData,
  MergedCandidate,
  MultiSourceResult,
  PlatformRating,
  SimilarWork,
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
    // Preserva letras/números de qualquer script (\p{L}/\p{N}) — antes
    // [^a-z0-9] descartava coreano/japonês/chinês, fazendo buscas pelo
    // título original retornarem 0 candidatos.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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

// Logger gated por DEBUG_EXTERNAL_SEARCH=1 — instrumentação temporária para
// diagnosticar falsos positivos em buscas de título.
const DEBUG_SEARCH = process.env.DEBUG_EXTERNAL_SEARCH === "1"
function debugLog(...args: unknown[]) {
  if (!DEBUG_SEARCH) return
  console.log("[searchAllSources][debug]", ...args)
}

type TitleSimReason =
  | "empty"
  | "exact"
  | "forward_substring"
  | "forward_substring_partial"
  | "reverse_substring_substantial"
  | "reverse_substring_significant"
  | "reverse_substring_marginal"
  | "jaccard"
  | "no_words"

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function titleSimilarityDetailed(a: string, b: string): { score: number; reason: TitleSimReason } {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return { score: 0, reason: "empty" }
  if (na === nb) return { score: 1, reason: "exact" }

  // Candidato contém a query — exige (1) que a query apareça como sequência
  // completa de palavras (word boundary) E (2) que não haja palavras extras
  // significativas demais no candidato. Sem isso, "Lucia" casava "Lucian"
  // (substring de palavra) e "Ending Maker" casava "Bad Ending Maker" (frase
  // contida mas com prefixo adjetival que muda a obra).
  if (nb.includes(na)) {
    const naBoundary = new RegExp(`\\b${escapeRegExp(na)}\\b`)
    if (naBoundary.test(nb)) {
      const ratio = na.length / nb.length
      const naWordSet = new Set(na.split(" ").filter((w) => w.length > 2))
      const extraSignificantWords = nb
        .split(" ")
        .filter((w) => w.length > 2 && !naWordSet.has(w)).length
      if (extraSignificantWords === 0 || ratio >= 0.85) {
        return { score: 0.9, reason: "forward_substring" }
      }
      if (extraSignificantWords <= 1 && ratio >= 0.55) {
        return { score: 0.78, reason: "forward_substring_partial" }
      }
      // Muitas palavras extras → cai pro Jaccard abaixo.
    }
    // Sem word boundary (ex.: "lucia" dentro de "lucian"), cai pro Jaccard.
  }

  // Query contém o candidato (reverse substring) — situação onde mais falsos
  // positivos acontecem. Ex.: buscar "The Fake Lady and Her Rabbit Duke" e
  // encontrar "Fake Lady" (obra completamente diferente). Gradua o score pela
  // proporção do candidato dentro da query + palavras significativas.
  if (na.includes(nb)) {
    const ratio = nb.length / na.length
    const shortWords = nb.split(" ").filter((w) => w.length > 2).length
    if (ratio >= 0.6 || shortWords >= 4) return { score: 0.9, reason: "reverse_substring_substantial" }
    if (ratio >= 0.4 || shortWords >= 3) return { score: 0.75, reason: "reverse_substring_significant" }
    if (ratio >= 0.25 && shortWords >= 2) return { score: 0.65, reason: "reverse_substring_marginal" }
    // Caso contrário cai pro Jaccard abaixo (provável rejeição pelo threshold)
  }

  const aw = new Set(na.split(" ").filter((w) => w.length > 2))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return { score: 0, reason: "no_words" }
  const intersection = [...aw].filter((word) => bw.has(word)).length
  return { score: intersection / new Set([...aw, ...bw]).size, reason: "jaccard" }
}

type MatchedNameKind = "title" | "originalTitle" | "alt"

export function bestTitleMatchDetailed(
  query: string,
  result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">
): { score: number; reason: TitleSimReason; matchedName: string | null; matchedKind: MatchedNameKind | null } {
  const candidates: Array<{ name: string | null | undefined; kind: MatchedNameKind }> = [
    { name: result.title, kind: "title" },
    { name: result.originalTitle, kind: "originalTitle" },
    ...(result.alternativeTitles ?? []).map((n) => ({ name: n, kind: "alt" as const })),
  ]
  let best: { score: number; reason: TitleSimReason; matchedName: string | null; matchedKind: MatchedNameKind | null } = {
    score: 0,
    reason: "empty",
    matchedName: null,
    matchedKind: null,
  }
  for (const { name, kind } of candidates) {
    if (!name) continue
    const sim = titleSimilarityDetailed(query, name)
    if (sim.score > best.score) {
      best = { score: sim.score, reason: sim.reason, matchedName: name, matchedKind: kind }
    }
  }
  return best
}

export function bestTitleMatch(query: string, result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">) {
  return bestTitleMatchDetailed(query, result).score
}

function altTitleOverlap(a: Array<string | null | undefined> = [], b: Array<string | null | undefined> = []): number {
  const setA = new Set(a.map((value) => normalizeText(value ?? "")).filter(Boolean))
  const setB = new Set(b.map((value) => normalizeText(value ?? "")).filter(Boolean))
  if (!setA.size || !setB.size) return 0
  const intersection = [...setA].filter((value) => setB.has(value)).length
  return intersection / Math.min(setA.size, setB.size)
}

function isLatinDominant(s: string | null | undefined): boolean {
  if (!s) return false
  const letters = s.replace(/[^\p{L}]/gu, "")
  if (letters.length === 0) return false
  const latin = letters.replace(/[^\p{Script=Latin}]/gu, "")
  return latin.length / letters.length >= 0.7
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

function sourceCandidateOption(
  result: ExternalSearchResult,
  matchScore: number,
  trusted = false
): ExternalSourceCandidateOption {
  return {
    source: result.source,
    externalId: sourceId(result),
    title: result.title,
    coverUrl: result.coverUrl ?? null,
    matchScore,
    synopsis: result.synopsis ?? null,
    year: result.year ?? null,
    chapters: result.chapters ?? null,
    trusted,
  }
}

function addSourceCandidateOption(
  candidate: MergedCandidate,
  option: ExternalSourceCandidateOption
) {
  const current = candidate.sourceCandidates ?? []
  const exists = current.some((item) =>
    item.source === option.source && item.externalId === option.externalId
  )
  if (!exists) candidate.sourceCandidates = [...current, option]
}

function addTrustedSourceCandidate(
  candidate: MergedCandidate,
  source: ExternalSourceId,
  externalId: string
) {
  addSourceCandidateOption(candidate, {
    source,
    externalId,
    title: candidate.title,
    coverUrl: candidate.coverUrl ?? null,
    matchScore: candidate.matchScore ?? 1,
    synopsis: candidate.synopsis ?? null,
    year: candidate.year ?? null,
    chapters: candidate.chapters ?? null,
    trusted: true,
  })
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
    .map((result) => {
      const detail = bestTitleMatchDetailed(query, result)
      return { result, matchScore: detail.score, matchDetail: detail }
    })
    .filter(({ matchScore }) => matchScore >= 0.65)
    .sort((a, b) => b.matchScore - a.matchScore)

  if (DEBUG_SEARCH) {
    debugLog(`  scored (matchScore ≥ 0.65): ${filtered.length}`)
    for (const item of filtered) {
      debugLog(
        `    [score=${item.matchScore.toFixed(2)}] ${item.result.title} (${item.result.source}) ` +
        `via ${item.matchDetail.matchedKind ?? "?"}="${item.matchDetail.matchedName ?? ""}" reason=${item.matchDetail.reason}`
      )
    }
  }

  const groups: Array<{ main: ExternalSearchResult; matchScore: number; results: ExternalSearchResult[] }> = []
  for (const item of filtered) {
    const group = groups.find((existing) => {
      // Antes: 0.78. Subido pra 0.85 porque o forward_substring antigo entregava
      // 0.9 fácil demais (qualquer obra com a query como substring caía no
      // mesmo grupo). Com o Fix A do titleSimilarity (word boundary + cap),
      // 0.85 ainda aceita matches exatos (1.0) e variantes próximas, mas
      // rejeita "Princess Lucia"/"Host Tenshi Lucian" no grupo de "Lucia".
      const sameTitle = bestTitleMatch(existing.main.title, item.result) >= 0.85
      // Lowered from 0.15 → 0.05: when title matches strongly, even minor synopsis
      // overlap should be enough. Some sources (Kitsu) return very different synopsis
      // formatting that gives spuriously low similarity.
      const compatibleSynopsis = synopsisSimilarity(existing.main.synopsis, item.result.synopsis) >= 0.05
      return sameTitle && compatibleSynopsis
    })
    if (group) {
      if (DEBUG_SEARCH) {
        const sim = bestTitleMatchDetailed(group.main.title, item.result)
        debugLog(
          `  merge: "${item.result.title}" (${item.result.source}) → group "${group.main.title}" ` +
          `(titleSim=${sim.score.toFixed(2)} via ${sim.matchedKind}="${sim.matchedName}" reason=${sim.reason})`
        )
      }
      group.results.push(item.result)
      group.matchScore = Math.max(group.matchScore, item.matchScore)
    } else {
      if (DEBUG_SEARCH) {
        debugLog(`  new group: main="${item.result.title}" (${item.result.source}) matchScore=${item.matchScore.toFixed(2)}`)
      }
      groups.push({ main: item.result, matchScore: item.matchScore, results: [item.result] })
    }
  }

  // Post-pass: collapse groups whose main titles collapse to the SAME alphanumeric-only
  // string. Catches case differences ("Is" vs "is"), hyphenation ("Newlywed" vs
  // "Newly-wed"), punctuation differences (": Vol" vs "Vol"), and whitespace variation.
  // Also tries every candidate's alternativeTitles for cross-matching.
  const stripAll = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // Remove 's possessivo antes do strip — sem isso, "The Empress' Needle"
      // (apóstrofo solto) e "The Empress's Needle" (apóstrofo + s) viravam
      // stripped keys diferentes (theempressneedle vs theempresssneedle),
      // impedindo o collapse de fundir a mesma obra entre fontes.
      .replace(/[''`]s(?=\s|$)/g, "")
      .replace(/[^a-z0-9]/g, "")
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
      const sharedKey = [...bKeys].find((k) => aKeys.has(k))
      if (!sharedKey) continue
      if (DEBUG_SEARCH) {
        debugLog(`  post-pass collapse: "${b.main.title}" → "${a.main.title}" (shared stripped key="${sharedKey}")`)
      }
      // merge b into a, then remove b
      a.results.push(...b.results.filter((r) => !a.results.some((existing) => existing.id === r.id)))
      a.matchScore = Math.max(a.matchScore, b.matchScore)
      // refresh aKeys with newly merged alts
      for (const k of bKeys) aKeys.add(k)
      groups.splice(j, 1)
    }
  }

  if (DEBUG_SEARCH) {
    debugLog(`  final groups (top 8 of ${groups.length}):`)
    for (const g of groups.slice(0, 8)) {
      const sources = [...new Set(g.results.map((r) => r.source))].join(", ")
      debugLog(`    main="${g.main.title}" matchScore=${g.matchScore.toFixed(2)} sources=[${sources}] resultCount=${g.results.length}`)
    }
  }

  return groups.slice(0, 8).map(({ main, matchScore, results }) => {
    // Antes: `new Map(results.map(...))` sobrescrevia silenciosamente quando
    // havia múltiplos resultados da mesma fonte no grupo, devolvendo o último
    // inserido. Isso fazia o display title pular pra um resultado arbitrário
    // (ex.: "Host Tenshi Lucian" quando havia 9 mangaupdates no grupo Lucia).
    // Agora ordenamos por matchScore desc e ficamos com o de maior score
    // por fonte.
    const matchById = new Map(filtered.map((item) => [item.result.id, item.matchScore]))
    const resultsByScore = [...results].sort(
      (a, b) => (matchById.get(b.id) ?? 0) - (matchById.get(a.id) ?? 0)
    )
    const bySource = new Map<ExternalSourceId, ExternalSearchResult>()
    for (const result of resultsByScore) {
      if (!bySource.has(result.source)) bySource.set(result.source, result)
    }
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
      sourceCandidates: results.map((result) =>
        sourceCandidateOption(result, matchById.get(result.id) ?? bestTitleMatch(query, result))
      ),
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
  if (DEBUG_SEARCH) debugLog(`query="${query}"`)
  const settled = await Promise.allSettled(
    SEARCH_CONNECTORS.map((connector) => connector.search(query))
  )
  const results = settled.flatMap((entry, i) => {
    const connectorName = SEARCH_CONNECTORS[i].source
    if (entry.status === "fulfilled") {
      if (DEBUG_SEARCH) {
        const titles = entry.value.slice(0, 6).map((r) => r.title).join(" | ")
        debugLog(`  raw ${connectorName}: ${entry.value.length} results — [${titles}${entry.value.length > 6 ? ", …" : ""}]`)
      }
      return entry.value
    }
    console.error(
      `[searchAllSources] connector ${connectorName} failed for query="${query}"`,
      entry.reason instanceof Error ? entry.reason.message : entry.reason
    )
    if (DEBUG_SEARCH) {
      debugLog(`  raw ${connectorName}: ERROR — ${entry.reason instanceof Error ? entry.reason.message : entry.reason}`)
    }
    return []
  })
  const merged = mergeSearchResults(query, results)
  hoistCrossSourceIds(merged)
  const refined = await refineWithAlternativeTitles(merged, query)
  hoistCrossSourceIds(refined)
  if (DEBUG_SEARCH) {
    debugLog(`  returned ${refined.length} candidates after refine:`)
    for (const c of refined) {
      debugLog(`    "${c.title}" matchScore=${(c.matchScore ?? 0).toFixed(2)} sources=[${c.sources.join(", ")}]`)
    }
  }
  return refined
}

// ============================================================================
// Candidate construction from persisted/accepted source IDs
// ============================================================================

const SUPPORTED_SOURCES: ReadonlySet<ExternalSourceId> = new Set([
  "anilist",
  "mangaupdates",
  "myanimelist",
  "kitsu",
  "mangadex",
  "comick",
  "comix",
  "animeplanet",
])

export function buildCandidateFromExternalIds(
  work: { title: string; originalTitle?: string | null; alternativeTitles?: string[] | null },
  externalIds: Partial<Record<ExternalSourceId, string | number | null | undefined>>
): MergedCandidate {
  const sources: ExternalSourceId[] = []
  const trustedSources: ExternalSourceId[] = []
  const candidate: MergedCandidate = {
    title: work.title,
    originalTitle: work.originalTitle ?? undefined,
    alternativeTitles: work.alternativeTitles ?? [],
    sources,
    trustedSources,
  }

  const addSource = (source: ExternalSourceId) => {
    if (!sources.includes(source)) sources.push(source)
    if (!trustedSources.includes(source)) trustedSources.push(source)
  }

  for (const [source, rawId] of Object.entries(externalIds) as Array<[ExternalSourceId, string | number | null | undefined]>) {
    if (!rawId || !SUPPORTED_SOURCES.has(source)) continue
    const id = String(rawId)
    addSource(source)
    switch (source) {
      case "anilist": {
        const n = Number(id)
        if (Number.isFinite(n)) candidate.anilistId = n
        break
      }
      case "mangaupdates": {
        const n = Number(id)
        if (Number.isFinite(n)) candidate.muId = n
        break
      }
      case "myanimelist": {
        const n = Number(id)
        if (Number.isFinite(n)) candidate.malId = n
        break
      }
      case "kitsu":
        candidate.kitsuId = id
        break
      case "mangadex":
        candidate.mangadexId = id
        break
      case "comick":
        candidate.comickHid = id
        break
      case "comix":
        candidate.comixHid = id
        break
      case "animeplanet":
        candidate.animePlanetSlug = id
        break
    }
  }

  return candidate
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
          addTrustedSourceCandidate(candidate, "anilist", cross.anilist)
        }
      }
      if (cross.mangaupdates && candidate.muId == null) {
        const n = Number(cross.mangaupdates)
        if (Number.isFinite(n)) {
          candidate.muId = n
          if (!candidate.sources.includes("mangaupdates")) candidate.sources = [...candidate.sources, "mangaupdates"]
          trust("mangaupdates")
          addTrustedSourceCandidate(candidate, "mangaupdates", cross.mangaupdates)
        }
      }
      if (cross.myanimelist && candidate.malId == null) {
        const n = Number(cross.myanimelist)
        if (Number.isFinite(n)) {
          candidate.malId = n
          if (!candidate.sources.includes("myanimelist")) candidate.sources = [...candidate.sources, "myanimelist"]
          trust("myanimelist")
          addTrustedSourceCandidate(candidate, "myanimelist", cross.myanimelist)
        }
      }
      if (cross.kitsu && !candidate.kitsuId) {
        candidate.kitsuId = cross.kitsu
        if (!candidate.sources.includes("kitsu")) candidate.sources = [...candidate.sources, "kitsu"]
        trust("kitsu")
        addTrustedSourceCandidate(candidate, "kitsu", cross.kitsu)
      }
      if (cross.animeplanet && !candidate.animePlanetSlug) {
        candidate.animePlanetSlug = cross.animeplanet
        if (!candidate.sources.includes("animeplanet")) candidate.sources = [...candidate.sources, "animeplanet"]
        trust("animeplanet")
        addTrustedSourceCandidate(candidate, "animeplanet", cross.animeplanet)
      }
      if (cross.mangadex && !candidate.mangadexId) {
        candidate.mangadexId = cross.mangadex
        if (!candidate.sources.includes("mangadex")) candidate.sources = [...candidate.sources, "mangadex"]
        trust("mangadex")
        addTrustedSourceCandidate(candidate, "mangadex", cross.mangadex)
      }
      if (cross.comick && !candidate.comickHid) {
        candidate.comickHid = cross.comick
        if (!candidate.sources.includes("comick")) candidate.sources = [...candidate.sources, "comick"]
        trust("comick")
        addTrustedSourceCandidate(candidate, "comick", cross.comick)
      }
      if (cross.comix && !candidate.comixHid) {
        candidate.comixHid = cross.comix
        if (!candidate.sources.includes("comix")) candidate.sources = [...candidate.sources, "comix"]
        trust("comix")
        addTrustedSourceCandidate(candidate, "comix", cross.comix)
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
  maxVariantsPerCandidate = 6,
): Promise<MergedCandidate[]> {
  const normalizedOriginal = normalizeText(originalQuery)
  const slice = candidates.slice(0, maxCandidates)

  await Promise.all(slice.map(async (candidate) => {
    // Enriquece alt titles do candidato com o `associated[]` do MU detail —
    // a search API do MU NÃO inclui associated names, só o endpoint de detalhe.
    // Sem isso, variantes críticas como "What Caused This to Happen...?!" nunca
    // entram no pool e o refinamento não acha a obra em fontes que só indexam
    // pelo título alternativo (ex.: ComicK).
    if (candidate.muId != null) {
      const muAlts = await fetchMangaUpdatesAlternativeTitles(candidate.muId)
      if (muAlts.length > 0) {
        candidate.alternativeTitles = uniqueStrings([
          ...(candidate.alternativeTitles ?? []),
          ...muAlts,
        ])
      }
    }

    // Skip inteligente: pula fontes onde algum título do resultado existente
    // bate EXATO com algum nome conhecido do candidato (já enriquecido com MU
    // associated names acima). Casos de falso positivo (ex.: ComicK retornando
    // obra diferente com título parecido) NÃO batem exato → fonte é retried.
    const candidateKeys = new Set(
      [candidate.title, candidate.originalTitle, ...(candidate.alternativeTitles ?? [])]
        .filter((n): n is string => Boolean(n))
        .map((n) => normalizeText(n))
        .filter((n) => n.length > 0)
    )
    const connectorsToTry = SEARCH_CONNECTORS.filter((c) => {
      if (!candidate.sources.includes(c.source)) return true
      const existingResults = candidate.sourceResults?.filter((r) => r.source === c.source) ?? []
      if (existingResults.length === 0) return true
      return !existingResults.some((result) => {
        const resultKeys = [result.title, result.originalTitle, ...(result.alternativeTitles ?? [])]
          .filter((n): n is string => Boolean(n))
          .map((n) => normalizeText(n))
        return resultKeys.some((k) => candidateKeys.has(k))
      })
    })
    if (connectorsToTry.length === 0) return

    const rawVariants = uniqueStrings([
      candidate.title,
      candidate.originalTitle,
      ...(candidate.alternativeTitles ?? []),
    ])
      .filter((v) => normalizeText(v) !== normalizedOriginal)
      .filter((v) => v.replace(/[^\p{L}\p{N}]/gu, "").length >= 3)

    // Variantes em alfabeto latino primeiro — bancos ocidentais (ComicK,
    // AnimePlanet) raramente indexam pinyin/CJK.
    const baseVariants = [
      ...rawVariants.filter(isLatinDominant),
      ...rawVariants.filter((v) => !isLatinDominant(v)),
    ].slice(0, maxVariantsPerCandidate)

    // Expande variantes só pras fontes strict-tokenize (ComicK, Kitsu) — outras
    // APIs casam fine com pontuação, não precisam dobrar fan-out.
    const stripPunct = (s: string) =>
      s.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
    const STRICT_TOKENIZE: ReadonlySet<ExternalSourceId> = new Set(["comick", "kitsu"])
    const variantsForSource = (source: ExternalSourceId): string[] =>
      STRICT_TOKENIZE.has(source)
        ? uniqueStrings([...baseVariants, ...baseVariants.map(stripPunct)])
        : baseVariants

    if (baseVariants.length === 0) return

    await Promise.all(connectorsToTry.map(async (connector) => {
      const queries = variantsForSource(connector.source)
      const settled = await Promise.allSettled(queries.map((v) => connector.search(v)))
      const flatResults = settled.flatMap((entry, i) => {
        if (entry.status === "fulfilled") return entry.value.map((result) => ({ result, variant: queries[i] }))
        console.error(
          `[searchAllSources] refine connector=${connector.source} variant="${queries[i]}" failed`,
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
          `[searchAllSources] refine source=${connector.source}: ${flatResults.length} raw, 0 accepted ` +
          `for candidate="${candidate.title}" — raw titles=[${flatResults.slice(0, 5).map((r) => r.result.title).join(" | ")}]`
        )
        return
      }

      const isNewSource = !candidate.sources.includes(connector.source)
      // Snapshot do melhor matchScore atual ANTES de adicionar novas opções —
      // pra decidir se o novo entry deve ser promovido a primário.
      const priorBestScore = Math.max(
        0,
        ...((candidate.sourceCandidates ?? [])
          .filter((o) => o.source === connector.source)
          .map((o) => o.matchScore ?? 0))
      )

      // Adiciona apenas o MELHOR resultado novo como opção — adicionar todos os
      // aceitos polui o picker com falsos positivos em fontes que devolveram
      // muitos resultados parcialmente parecidos (ex.: várias obras "Pure Love"
      // diferentes pra uma busca contendo "Pure Love" como variante).
      const best = accepted.find((entry) => {
        if (candidate.sourceResults?.some((r) => r.id === entry.result.id)) return false
        const extId = sourceId(entry.result)
        const dupOption = (candidate.sourceCandidates ?? []).some(
          (o) => o.source === connector.source && o.externalId === extId
        )
        return !dupOption
      })
      if (!best) return

      addSourceCandidateOption(candidate, sourceCandidateOption(best.result, best.titleScore))

      // Promove pro `sourceResults`/IDs só se a fonte estava ausente OU se o
      // novo match supera o existente por margem significativa. Caso contrário,
      // mantém o primário atual e o novo fica como opção no picker.
      const shouldPromote = isNewSource || best.titleScore >= priorBestScore + 0.1

      if (shouldPromote) {
        candidate.sources = [...new Set([...candidate.sources, connector.source])]
        candidate.sourceResults = [...(candidate.sourceResults ?? []), best.result]
        candidate.alternativeTitles = uniqueStrings([
          ...(candidate.alternativeTitles ?? []),
          best.result.originalTitle,
          ...(best.result.alternativeTitles ?? []),
        ])
        candidate.genres = uniqueStrings([...(candidate.genres ?? []), ...(best.result.genres ?? [])])
        if (isNewSource) fillCandidateIdFromResult(candidate, best.result)
      }

      console.log(
        `[searchAllSources] refine added source=${connector.source} via variant="${best.variant}" ` +
        `to candidate="${candidate.title}" (title=${best.titleScore.toFixed(2)} ` +
        `composite=${best.composite.toFixed(2)} promote=${shouldPromote})`
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
    candidate.mangadexId
      ? fetchMangaDexForumComments(candidate.mangadexId).then((reviews) => ({ source: "mangadex" as const, reviews }))
      : Promise.resolve(null),
  ]

  const settled = await Promise.allSettled(fetchers)

  // DEBUG: contar reviews raw por fonte antes de filtrar
  const rawCounts = settled.map((entry, i) => {
    const src = ["mangaupdates", "anilist", "myanimelist", "kitsu", "animeplanet", "mangadex"][i]
    if (entry.status === "rejected") return `${src}=REJECTED(${entry.reason})`
    if (!entry.value) return `${src}=skipped(no_id)`
    const reviews = entry.value.reviews
    const lens = reviews.map((r) => r.length).sort((a, b) => b - a).slice(0, 3)
    return `${src}=${reviews.length}(top3lens=${lens.join(",")})`
  })
  console.log(`[collectReviews] candidate="${candidate.title}" ids={mu:${candidate.muId},ani:${candidate.anilistId},mal:${candidate.malId},kitsu:${candidate.kitsuId},ap:${candidate.animePlanetSlug},md:${candidate.mangadexId}} raw=${rawCounts.join(" ")}`)

  // Kitsu expõe "reactions" (não reviews completos), tipicamente 40-90 chars.
  // Pra outras fontes mantemos o threshold em 100 (reviews curtos demais
  // adicionam ruído). Pra Kitsu baixamos pra 30 — uma frase como "great FL,
  // dark psychological tone" já vira sinal útil pro modelo.
  const minLengthBySource: Partial<Record<ExternalSourceId, number>> = {
    kitsu: 30,
    // mangadex já vem com filtro + dedup no fetcher (XenForo tem muito ruído);
    // o threshold daqui é redundante mas explícito.
    mangadex: 150,
  }
  return settled
    .flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []))
    .flatMap((group) =>
      group.reviews
        .filter((text) => text.trim().length >= (minLengthBySource[group.source] ?? 100))
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
 * Normaliza título para dedup entre fontes (mesma obra pode aparecer com
 * variações de capitalização, pontuação, espaços).
 */
function normalizeSimilarTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Coleta obras similares ("if you liked X, try Y") em paralelo das fontes que
 * expõem recomendações curadas pela comunidade: AniList (rating + tags), Jikan/MAL
 * (votos), AnimePlanet (apenas títulos via scrape).
 *
 * Faz merge por título normalizado: quando a mesma obra aparece em ≥2 fontes,
 * soma os pesos e concatena `sources`. Ranqueia por (nº de fontes, peso) e
 * devolve até `limit` (default 6). Nenhuma fonte é obrigatória — fail-soft.
 */
async function collectSimilarFromCandidate(candidate: MergedCandidate, limit = 6): Promise<SimilarWork[]> {
  const fetchers: Array<Promise<unknown>> = [
    candidate.anilistId
      ? fetchAniListRecommendations(candidate.anilistId).then((recs) => ({ source: "anilist" as const, recs }))
      : Promise.resolve(null),
    candidate.malId
      ? fetchJikanMangaRecommendations(candidate.malId).then((recs) => ({ source: "myanimelist" as const, recs }))
      : Promise.resolve(null),
    candidate.animePlanetSlug
      ? fetchAnimePlanetRecommendations(candidate.animePlanetSlug).then((titles) => ({ source: "animeplanet" as const, titles }))
      : Promise.resolve(null),
  ]

  const settled = await Promise.allSettled(fetchers)
  const merged = new Map<string, SimilarWork>()

  function upsert(title: string, source: ExternalSourceId, weight: number, genres?: string[], tags?: string[]) {
    const key = normalizeSimilarTitle(title)
    if (!key) return
    const existing = merged.get(key)
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source)
      existing.weight = (existing.weight ?? 0) + weight
      if (genres?.length) {
        existing.genres = uniqueStrings([...existing.genres, ...genres])
      }
      if (tags?.length) {
        existing.tags = uniqueStrings([...(existing.tags ?? []), ...tags])
      }
      return
    }
    merged.set(key, {
      title,
      genres: genres ?? [],
      tags: tags && tags.length > 0 ? tags : undefined,
      sources: [source],
      weight,
    })
  }

  for (const entry of settled) {
    if (entry.status !== "fulfilled" || !entry.value) continue
    const value = entry.value as
      | { source: "anilist"; recs: Awaited<ReturnType<typeof fetchAniListRecommendations>> }
      | { source: "myanimelist"; recs: Awaited<ReturnType<typeof fetchJikanMangaRecommendations>> }
      | { source: "animeplanet"; titles: string[] }

    if (value.source === "anilist") {
      for (const rec of value.recs) {
        upsert(rec.title, "anilist", rec.rating, rec.genres, rec.tags)
      }
    } else if (value.source === "myanimelist") {
      for (const rec of value.recs) {
        upsert(rec.title, "myanimelist", rec.votes)
      }
    } else {
      // animeplanet — sem peso, atribui 1 fixo (sinal apenas de presença)
      for (const title of value.titles) {
        upsert(title, "animeplanet", 1)
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      const sourceDiff = b.sources.length - a.sources.length
      if (sourceDiff !== 0) return sourceDiff
      return (b.weight ?? 0) - (a.weight ?? 0)
    })
    .slice(0, limit)
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

function restrictCandidateToSources(candidate: MergedCandidate, sources: ReadonlySet<ExternalSourceId>): MergedCandidate {
  return {
    ...candidate,
    sources: candidate.sources.filter((source) => sources.has(source)),
    trustedSources: candidate.trustedSources?.filter((source) => sources.has(source)),
    sourceResults: candidate.sourceResults?.filter((result) => sources.has(result.source)),
    anilistId: sources.has("anilist") ? candidate.anilistId : undefined,
    muId: sources.has("mangaupdates") ? candidate.muId : undefined,
    kitsuId: sources.has("kitsu") ? candidate.kitsuId : undefined,
    mangadexId: sources.has("mangadex") ? candidate.mangadexId : undefined,
    malId: sources.has("myanimelist") ? candidate.malId : undefined,
    comickHid: sources.has("comick") ? candidate.comickHid : undefined,
    comixHid: sources.has("comix") ? candidate.comixHid : undefined,
    animePlanetSlug: sources.has("animeplanet") ? candidate.animePlanetSlug : undefined,
  }
}

// ============================================================================
// Review context cache (TTL 5min)
// ============================================================================
// Cobre o caso "fechei o popup da avaliação e cliquei em Reavaliar de novo":
// os fetchers externos (MU/AniList/MAL/Kitsu/AnimePlanet/MangaDex) dominam o
// tempo total (5-30s) e raramente mudam em janelas curtas. A chave deriva da
// identidade do candidato (título + IDs externos) e dos filtros, NÃO do
// workId — assim Path A e Path B compartilham cache quando os IDs batem.
// Armazenamos a Promise (não o resultado) pra deduplicar chamadas concorrentes
// pra mesma chave. Falhas evitam o cache pra a próxima call retentar fresh.

const REVIEW_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const REVIEW_CONTEXT_CACHE_MAX_ENTRIES = 100

interface ReviewContextResult {
  sourcedReviews: SourcedReview[]
  allReviews: SourcedReview[]
  externalContext: string[]
  platformRatings: PlatformRating[]
  similarWorks: SimilarWork[]
}

interface ReviewContextCacheEntry {
  promise: Promise<ReviewContextResult>
  expiresAt: number
}

const reviewContextCache = new Map<string, ReviewContextCacheEntry>()

function reviewContextCacheKey(parts: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {}
  for (const k of Object.keys(parts).sort()) ordered[k] = parts[k]
  return JSON.stringify(ordered)
}

function readReviewContextCache(key: string): Promise<ReviewContextResult> | null {
  const entry = reviewContextCache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    reviewContextCache.delete(key)
    return null
  }
  reviewContextCache.delete(key)
  reviewContextCache.set(key, entry)
  return entry.promise
}

function writeReviewContextCache(key: string, promise: Promise<ReviewContextResult>): void {
  reviewContextCache.set(key, {
    promise,
    expiresAt: Date.now() + REVIEW_CONTEXT_CACHE_TTL_MS,
  })
  while (reviewContextCache.size > REVIEW_CONTEXT_CACHE_MAX_ENTRIES) {
    const oldest = reviewContextCache.keys().next().value
    if (oldest === undefined) break
    reviewContextCache.delete(oldest)
  }
  promise.catch(() => {
    if (reviewContextCache.get(key)?.promise === promise) {
      reviewContextCache.delete(key)
    }
  })
}

async function hydrateAndFilterCandidate(candidate: MergedCandidate): Promise<{
  hydrated: ExternalSearchResult[]
  accepted: ExternalSearchResult[]
  uniqueAccepted: ExternalSearchResult[]
  rejected: Array<{ result: ExternalSearchResult; reason?: string }>
  apDetail: AnimePlanetDetail | null
  muStatusText: string | undefined
}> {
  const { hydrated, apDetail, muStatusText } = await hydrateCandidate(candidate)
  const accepted: ExternalSearchResult[] = []
  const rejected: Array<{ result: ExternalSearchResult; reason?: string }> = []
  const trustedSet = new Set(candidate.trustedSources ?? [])

  for (const result of hydrated) {
    const { titleScore, synScore, composite, reason } = compositeAcceptScore(candidate, result)
    const passes = titleScore >= 0.72 && synScore >= 0.18 && composite >= 0.62
    const acceptedBySource = passes || trustedSet.has(result.source)
    console.info(
      `[hydrateAccept] candidate="${candidate.title}" source=${result.source} title=${titleScore.toFixed(2)} syn=${synScore.toFixed(2)} composite=${composite.toFixed(2)} trusted=${trustedSet.has(result.source)} accept=${acceptedBySource}${reason ? ` reason="${reason}"` : ""}`
    )
    if (acceptedBySource) accepted.push({ ...result, score: result.score })
    else rejected.push({ result, reason })
  }

  const uniqueAccepted = Array.from(new Map(accepted.map((result) => [result.id, result])).values())
    .sort((a, b) => {
      if (a.source === "mangaupdates") return -1
      if (b.source === "mangaupdates") return 1
      return 0
    })

  return { hydrated, accepted, uniqueAccepted, rejected, apDetail, muStatusText }
}

export async function fetchExternalEvaluationContextForCandidate(
  candidate: MergedCandidate,
  opts: {
    rejectedSources?: ReadonlyArray<string>
    perSource?: number
    total?: number
  } = {}
): Promise<ReviewContextResult> {
  const cacheKey = reviewContextCacheKey({
    fn: "candidate",
    title: candidate.title,
    anilistId: candidate.anilistId ?? null,
    muId: candidate.muId ?? null,
    malId: candidate.malId ?? null,
    kitsuId: candidate.kitsuId ?? null,
    mangadexId: candidate.mangadexId ?? null,
    animePlanetSlug: candidate.animePlanetSlug ?? null,
    comickHid: candidate.comickHid ?? null,
    rejectedSources: [...(opts.rejectedSources ?? [])].sort(),
    perSource: opts.perSource ?? 8,
    total: opts.total ?? 30,
  })
  const cached = readReviewContextCache(cacheKey)
  if (cached) {
    console.info(`[reviews-cache] hit candidate "${candidate.title}"`)
    return cached
  }
  const promise = fetchExternalEvaluationContextForCandidateUncached(candidate, opts)
  writeReviewContextCache(cacheKey, promise)
  return promise
}

/** Pool completo de reviews coletadas, antes do filtro de seleção pro prompt.
 * `allReviews` é usado pra persistir em `work_reviews`; `sourcedReviews` é só
 * o que cabe no prompt e perde sinal pra a recomendação. */
async function fetchExternalEvaluationContextForCandidateUncached(
  candidate: MergedCandidate,
  opts: {
    rejectedSources?: ReadonlyArray<string>
    perSource?: number
    total?: number
  } = {}
): Promise<ReviewContextResult> {
  const { uniqueAccepted } = await hydrateAndFilterCandidate(candidate)
  const rejected = new Set((opts.rejectedSources ?? []) as string[])
  const filteredAccepted = rejected.size > 0
    ? uniqueAccepted.filter((result) => !rejected.has(result.source))
    : uniqueAccepted
  const acceptedSources = new Set(filteredAccepted.map((result) => result.source))
  // Fontes trusted (IDs externos confirmados) nem sempre entram em `hydrated`:
  // o AnimePlanet, por design, é carregado via apDetail e nunca vira um
  // ExternalSearchResult, então `acceptedSources` jamais o continha e o
  // restrictCandidateToSources zerava o animePlanetSlug — fazendo as reviews do
  // AnimePlanet nunca serem buscadas. Como trusted = identidade confirmada,
  // coletamos reviews dessas fontes direto, respeitando só os rejectedSources.
  const reviewSources = new Set([
    ...acceptedSources,
    ...(candidate.trustedSources ?? []).filter((source) => !rejected.has(source)),
  ])
  const reviewCandidate = restrictCandidateToSources(candidate, reviewSources)
  const [allReviews, similarWorks] = await Promise.all([
    collectReviewsFromCandidate(reviewCandidate),
    collectSimilarFromCandidate(reviewCandidate),
  ])

  const platformRatings: PlatformRating[] = filteredAccepted
    .filter((result) => typeof result.score === "number" || typeof result.votes === "number")
    .map((result) => ({
      platform: result.source,
      rating: typeof result.score === "number" ? result.score : undefined,
      votes: typeof result.votes === "number" ? result.votes : undefined,
    }))

  return {
    sourcedReviews: selectReviewsForEvaluation(allReviews, {
      perSource: opts.perSource ?? 8,
      total: opts.total ?? 30,
    }),
    allReviews,
    externalContext: uniqueSynopsisBlocks(
      filteredAccepted.map((result) => result.synopsis)
    ).slice(0, 6),
    platformRatings,
    similarWorks,
  }
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
}): Promise<ReviewContextResult> {
  const cacheKey = reviewContextCacheKey({
    fn: "work",
    title: input.title,
    originalTitle: input.originalTitle ?? null,
    alternativeTitles: [...(input.alternativeTitles ?? [])].sort(),
    rejectedSources: [...(input.rejectedSources ?? [])].sort(),
  })
  const cached = readReviewContextCache(cacheKey)
  if (cached) {
    console.info(`[reviews-cache] hit work "${input.title}"`)
    return cached
  }
  const promise = fetchExternalEvaluationContextForWorkUncached(input)
  writeReviewContextCache(cacheKey, promise)
  return promise
}

async function fetchExternalEvaluationContextForWorkUncached(input: {
  title: string
  originalTitle?: string | null
  alternativeTitles?: string[] | null
  rejectedSources?: ReadonlyArray<string>
}): Promise<ReviewContextResult> {
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
      const result = await fetchExternalEvaluationContextForCandidate(candidate, {
        rejectedSources: [...rejected],
        perSource: 8,
        total: 30,
      })
      if (
        result.sourcedReviews.length ||
        result.externalContext.length ||
        result.platformRatings.length ||
        result.similarWorks.length
      ) {
        return result
      }
    }
  }

  return { sourcedReviews: [], allReviews: [], externalContext: [], platformRatings: [], similarWorks: [] }
}

// ============================================================================
// Hydration
// ============================================================================

async function hydrateCandidate(candidate: MergedCandidate): Promise<{ hydrated: ExternalSearchResult[]; apDetail: AnimePlanetDetail | null; muStatusText: string | undefined }> {
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
  const muStatusText = typeof mu?.statusText === "string" ? mu.statusText : undefined
  return { hydrated, apDetail: ap as AnimePlanetDetail | null, muStatusText }
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

function mergeData(candidate: MergedCandidate, accepted: ExternalSearchResult[], apDetail?: AnimePlanetDetail | null, muStatusText?: string): ExternalWorkData {
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
    if (isBlockedCoverUrl(result.coverUrl)) continue
    if (seenCoverUrls.has(result.coverUrl)) continue
    seenCoverUrls.add(result.coverUrl)
    multiCoversRaw.push({ url: result.coverUrl, source: result.source })
  }
  // AnimePlanet flows through apDetail (separate from accepted) — surface its cover here.
  if (apDetail?.coverUrl && !isBlockedCoverUrl(apDetail.coverUrl) && !seenCoverUrls.has(apDetail.coverUrl)) {
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
    originalTitle: primary.originalTitle ?? candidate.originalTitle ?? accepted.find((result) => result.originalTitle)?.originalTitle,
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
    mangaUpdatesStatusText: muStatusText,
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
  const { apDetail, uniqueAccepted, rejected, muStatusText } = await hydrateAndFilterCandidate(candidate)
  const data = mergeData(candidate, uniqueAccepted, apDetail, muStatusText)

  // Persist external IDs for accepted sources. Cross-linked/trusted IDs are also
  // safe to keep even when a scraper is temporarily blocked (AnimePlanet/CF),
  // so future refreshes can retry by canonical ID instead of losing the source.
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
  const trustedSources = new Set(candidate.trustedSources ?? [])
  const externalIds: Partial<Record<ExternalSourceId, string>> = {}
  for (const [source, id] of Object.entries(candidateIds) as Array<[ExternalSourceId, string | undefined]>) {
    if (id && (acceptedSources.has(source) || trustedSources.has(source))) externalIds[source] = id
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
    acceptedSources: uniqueAccepted.map((result) => sourceDebug(result, true)),
    rejectedSources: rejected.map(({ result, reason }) => sourceDebug(result, false, reason ?? "Título/sinopse não bateram com o candidato principal")),
    mergedSynopses: uniqueAccepted.flatMap((result) =>
      splitSynopsisBlocks(result.synopsis).map((text) => ({ source: result.source as ExternalSourceId, text }))
    ),
  }
  data.debug = debug

  return { data, conflicts, debug }
}
