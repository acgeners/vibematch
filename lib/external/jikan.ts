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

const DEBUG_SEARCH = process.env.DEBUG_EXTERNAL_SEARCH === "1"

// Jikan é mais tolerante que ComicK, mas títulos longos com hífen às vezes
// caem fora do top 5. Mesma estratégia de fallback: se a query tem pontuação,
// dispara também variante stripada em paralelo e funde por mal_id.
function stripPunctForQuery(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
}

// Jikan retorna 504 ("Jikan failed to connect to MyAnimeList") e 429 (rate-limit)
// com frequência. Antes o código engolia silenciosamente e a fonte aparecia como
// "Nenhum match" sem distinguir API caída de obra inexistente. Agora loga e
// tenta de novo com backoff curto pra status transientes.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

async function fetchJikanSearchRows(query: string, maxAttempts = 3): Promise<unknown[]> {
  const url = new URL(`${JIKAN_BASE}/manga`)
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "5")

  let lastStatus: number | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res: Response
    try {
      res = await fetch(url, { cache: "no-store" })
    } catch (err) {
      console.error(`[searchJikanManga] network error attempt ${attempt}/${maxAttempts} q="${query}":`, err instanceof Error ? err.message : err)
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 400 * attempt))
      continue
    }
    if (res.ok) {
      const json = await res.json()
      return Array.isArray(json?.data) ? json.data : []
    }
    lastStatus = res.status
    if (!TRANSIENT_STATUSES.has(res.status)) {
      console.error(`[searchJikanManga] non-retryable HTTP ${res.status} q="${query}"`)
      return []
    }
    if (attempt < maxAttempts) {
      const delay = res.status === 429 ? 1200 * attempt : 500 * attempt
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  console.error(`[searchJikanManga] gave up after ${maxAttempts} attempts (last HTTP ${lastStatus}) q="${query}"`)
  return []
}

export async function searchJikanManga(title: string): Promise<JikanMangaResult[]> {
  try {
    const stripped = stripPunctForQuery(title)
    const queries = stripped && stripped.toLowerCase() !== title.toLowerCase()
      ? [title, stripped]
      : [title]

    // Importante: NÃO usar queries.map(fetchJikanSearchRows) — Array.map passa
    // (element, index, array), e o index sobrescreveria o param maxAttempts default.
    const settled = await Promise.allSettled(queries.map((q) => fetchJikanSearchRows(q)))
    const seenIds = new Set<number>()
    const mergedRows: unknown[] = []
    let rawCount = 0
    let strippedRawCount = 0
    settled.forEach((entry, i) => {
      if (entry.status !== "fulfilled") return
      if (i === 0) rawCount = entry.value.length
      else strippedRawCount = entry.value.length
      for (const item of entry.value) {
        const malId = (item as Record<string, unknown>)?.mal_id
        if (typeof malId !== "number" || seenIds.has(malId)) continue
        seenIds.add(malId)
        mergedRows.push(item)
      }
    })

    if (DEBUG_SEARCH && queries.length > 1) {
      console.log(
        `[searchJikanManga][debug] q="${title}" stripped="${stripped}" ` +
        `raw=${rawCount} stripped_raw=${strippedRawCount} merged=${mergedRows.length}`
      )
    }

    return mergedRows
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

export interface JikanRecommendation {
  title: string
  /** Número de usuários que sugeriram esta recomendação. Sinal de consenso. */
  votes: number
}

export async function fetchJikanMangaRecommendations(malId: number): Promise<JikanRecommendation[]> {
  try {
    const res = await fetch(`${JIKAN_BASE}/manga/${malId}/recommendations`, { cache: "no-store" })
    if (!res.ok) return []

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []

    return data
      .map((item): JikanRecommendation | null => {
        const record = item as Record<string, unknown>
        const entry = record.entry as Record<string, unknown> | undefined
        const title = typeof entry?.title === "string" ? entry.title : null
        if (!title) return null
        const votes = typeof record.votes === "number" ? record.votes : 0
        return { title, votes }
      })
      .filter((entry): entry is JikanRecommendation => entry !== null)
      .filter((entry) => entry.votes > 0)
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function fetchJikanMangaReviews(malId: number): Promise<string[]> {
  // Jikan retorna 25 reviews por página. Pegamos páginas 1 e 2 em sequência.
  // `preliminary=true` é essencial pra manhwa em andamento — a maioria das
  // reviews fica marcada como preliminary no MAL e seria filtrada por padrão.
  // `spoiler=true` inclui reviews com spoiler (sinal valioso pra avaliação IA).
  async function fetchPage(page: number): Promise<unknown[]> {
    try {
      const url = new URL(`${JIKAN_BASE}/manga/${malId}/reviews`)
      url.searchParams.set("page", String(page))
      url.searchParams.set("preliminary", "true")
      url.searchParams.set("spoiler", "true")
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) return []
      const json = await res.json()
      return Array.isArray(json?.data) ? json.data : []
    } catch {
      return []
    }
  }

  try {
    const [page1, page2] = await Promise.all([fetchPage(1), fetchPage(2)])
    const combined = [...page1, ...page2]
    return combined
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
      .slice(0, 50)
      .map((review) => review.slice(0, 900))
  } catch {
    return []
  }
}
