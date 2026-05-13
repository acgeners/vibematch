import type { PublicationStatus } from "@/types/domain"

const JIKAN_BASE = "https://api.jikan.moe/v4"

export interface JikanMangaResult {
  id: number
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  score?: number
  scoredBy?: number
}

export interface JikanMangaDetail {
  id: number
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  chapters?: number
  publicationStatus?: PublicationStatus
  /** MAL score 0-10 */
  rating?: number
  /** scored_by — number of users who scored */
  votes?: number
  genres: string[]
}

function cleanText(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

function titleCandidates(item: Record<string, unknown>): string[] {
  const titles = Array.isArray(item.titles) ? item.titles : []
  return [
    item.title,
    item.title_english,
    ...(Array.isArray(item.title_synonyms) ? item.title_synonyms : []),
    ...titles.map((entry) => (
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>).title
        : null
    )),
  ].map(cleanText).filter(Boolean)
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function titleMatchScore(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const shorter = na.length <= nb.length ? na : nb
  const shorterWordCount = shorter.split(/\s+/).filter(Boolean).length
  if ((na.includes(nb) || nb.includes(na)) && (shorterWordCount >= 3 || shorter.length >= 18)) {
    return 0.92
  }

  const tok = (s: string) => new Set(s.split(/\s+/).filter((w) => w.length > 2))
  const wa = tok(na)
  const wb = tok(nb)
  if (wa.size === 0 || wb.size === 0) return 0
  const inter = [...wa].filter((w) => wb.has(w)).length
  return inter / new Set([...wa, ...wb]).size
}

function bestRecordForTitle(records: Record<string, unknown>[], query: string, threshold = 0.7) {
  const ranked = records
    .map((record) => ({
      record,
      score: Math.max(...titleCandidates(record).map((title) => titleMatchScore(title, query)), 0),
    }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.record ?? null
}

function statusFromJikan(raw: unknown): PublicationStatus | undefined {
  if (typeof raw !== "string") return undefined
  switch (raw.toLowerCase()) {
    case "finished": return "Completed"
    case "publishing": return "Ongoing"
    case "on hiatus": return "Hiatus"
    case "discontinued": return "Cancelled"
    case "not yet published": return "Unknown"
    default: return "Unknown"
  }
}

function yearFromIso(date: unknown): number | undefined {
  if (typeof date !== "string" || date.length < 4) return undefined
  const n = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(n) ? n : undefined
}

function coverFromImages(images: unknown): string | undefined {
  if (!images || typeof images !== "object") return undefined
  const jpg = (images as Record<string, unknown>).jpg as Record<string, string> | undefined
  return jpg?.large_image_url ?? jpg?.image_url ?? undefined
}

function genresFromRecord(record: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ["genres", "themes", "demographics"]) {
    const arr = record[key]
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        const name = (entry as Record<string, unknown>)?.name
        if (typeof name === "string") out.push(name)
      }
    }
  }
  return Array.from(new Set(out))
}

export async function searchJikanManga(title: string): Promise<JikanMangaResult[]> {
  try {
    const url = new URL(`${JIKAN_BASE}/manga`)
    url.searchParams.set("q", title)
    url.searchParams.set("limit", "5")

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return []

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []

    return data
      .map((item): JikanMangaResult | null => {
        const record = item as Record<string, unknown>
        const id = typeof record.mal_id === "number" ? record.mal_id : null
        const titles = titleCandidates(record)
        const title = titles[0]
        if (!id || !title) return null
        const published = record.published as Record<string, unknown> | undefined
        return {
          id,
          title,
          alternativeTitles: Array.from(new Set(titles.slice(1).filter((item) => item !== title))),
          synopsis: typeof record.synopsis === "string" ? cleanText(record.synopsis) : undefined,
          coverUrl: coverFromImages(record.images),
          year: typeof record.year === "number" ? record.year : yearFromIso(published?.from),
          chapters: typeof record.chapters === "number" ? record.chapters : undefined,
          score: typeof record.score === "number" ? record.score : undefined,
          scoredBy: typeof record.scored_by === "number" ? record.scored_by : undefined,
        }
      })
      .filter((item): item is JikanMangaResult => item !== null)
  } catch {
    return []
  }
}

function recordToDetail(record: Record<string, unknown>, malId: number): JikanMangaDetail {
  const titles = titleCandidates(record)
  const primary = titles[0] ?? ""
  const published = record.published as Record<string, unknown> | undefined
  return {
    id: malId,
    title: primary,
    alternativeTitles: Array.from(new Set(titles.slice(1).filter((item) => item !== primary))),
    synopsis: typeof record.synopsis === "string" ? cleanText(record.synopsis) : undefined,
    coverUrl: coverFromImages(record.images),
    year: typeof record.year === "number" ? record.year : yearFromIso(published?.from),
    yearEnd: yearFromIso(published?.to),
    chapters: typeof record.chapters === "number" ? record.chapters : undefined,
    publicationStatus: statusFromJikan(record.status),
    rating: typeof record.score === "number" ? record.score : undefined,
    votes: typeof record.scored_by === "number" ? record.scored_by : undefined,
    genres: genresFromRecord(record),
  }
}

/**
 * Fetches MAL metadata via the search endpoint, which is cached by Jikan and
 * does not require scraping MAL directly (unlike /manga/{id} which often fails).
 */
export async function fetchJikanMangaByTitle(title: string, threshold = 0.7): Promise<JikanMangaDetail | null> {
  try {
    const url = new URL(`${JIKAN_BASE}/manga`)
    url.searchParams.set("q", title)
    url.searchParams.set("limit", "10")

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []
    const record = bestRecordForTitle(data as Record<string, unknown>[], title, threshold)
    if (!record) return null

    const id = typeof record.mal_id === "number" ? record.mal_id : null
    if (!id) return null

    return recordToDetail(record, id)
  } catch {
    return null
  }
}

/** @deprecated MAL blocks Jikan's scraping intermittently — prefer fetchJikanMangaByTitle */
export async function fetchJikanMangaById(malId: number): Promise<JikanMangaDetail | null> {
  try {
    const res = await fetch(`${JIKAN_BASE}/manga/${malId}/full`, { cache: "no-store" })
    if (!res.ok) return null

    const json = await res.json()
    const record = json?.data as Record<string, unknown> | undefined
    if (!record) return null

    return recordToDetail(record, malId)
  } catch {
    return null
  }
}

export async function fetchJikanMangaReviews(malId: number): Promise<string[]> {
  try {
    const url = new URL(`${JIKAN_BASE}/manga/${malId}/reviews`)
    url.searchParams.set("page", "1")

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return []

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []

    return data
      .map((item) => {
        const record = item as Record<string, unknown>
        const review = cleanText(record.review)
        if (!review) return ""

        const score = record.score
        return typeof score === "number"
          ? `Nota do usuário: ${score}/10\n${review}`
          : review
      })
      .filter(Boolean)
      .slice(0, 20)
      .map((review) => review.slice(0, 900))
  } catch {
    return []
  }
}
