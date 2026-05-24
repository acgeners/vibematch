import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const MU_BASE = "https://api.mangaupdates.com/v1"
const MU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json",
}

function mapStatus(status: string | undefined): PublicationStatus {
  if (!status) return "Unknown" as PublicationStatus
  const s = status.toLowerCase()
  if (s.includes("complete")) return "Completed"
  if (s.includes("hiatus")) return "Hiatus"
  if (s.includes("cancel") || s.includes("axed")) return "Cancelled"
  if (s.includes("ongoing") || s.includes("continuing")) return "Ongoing"
  return "Unknown" as PublicationStatus
}

// MU status field format: "50 Chapters (Ongoing)\n\nS1: 42 Chapters (1-42)\n\nS2: 8 Chapters (Ongoing) 43~"
// The first number at the start of the string is the total chapter count.
function parseChaptersFromStatus(status: string | undefined): number | undefined {
  if (!status) return undefined
  const m = status.match(/^(\d+)\s+chapters?/i)
  return m ? parseInt(m[1], 10) : undefined
}

function cleanHtml(text: string | undefined): string | undefined {
  if (!text) return undefined
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim() || undefined
}

function uniqueTitles(values: Array<string | null | undefined>, primary?: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const primaryKey = primary?.trim().toLowerCase()
  for (const value of values) {
    const title = value?.trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (!key || key === primaryKey || seen.has(key)) continue
    seen.add(key)
    out.push(title)
  }
  return out
}

function parseMangaUpdatesComments(html: string): string[] {
  const comments: string[] = []
  const rowRegex = /<div class="row g-0" data-cy="comment-row">([\s\S]*?)(?=<div class="row g-0" data-cy="comment-row">|<div class="p-2 pt-2 pb-2 text">|<\/div><script nonce=)/g

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null && comments.length < 30) {
    const row = match[1]
    const title = cleanHtml(row.match(/comment_title[^>]*>([\s\S]*?)(?:<!-- -->|<\/div>)/)?.[1])
    const rating = cleanHtml(row.match(/Rating:\s*(?:<\/span>)?([\s\S]*?)(?:<span|<\/div>)/)?.[1])
    const body = cleanHtml(
      row.match(/<div class="p-3 col-12">\s*<div class="[^"]*mu_markdown[^"]*">([\s\S]*?)<\/div>\s*<\/div>/)?.[1]
    )

    if (!body) continue

    comments.push(
      [
        title ? `Título do comentário: ${title}` : null,
        rating && !rating.includes("N/A") ? `Nota do usuário: ${rating}/10` : null,
        body,
      ].filter(Boolean).join("\n")
    )
  }

  return comments
}

export async function searchMangaUpdates(search: string): Promise<ExternalSearchResult[]> {
  try {
    const res = await fetch(`${MU_BASE}/series/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search, perpage: 8 }),
      cache: "no-store",
    })
    if (!res.ok) return []
    const json = await res.json()
    const results: unknown[] = json?.results ?? []

    return results.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = r as any
      const rec = item.record ?? {}
      // Prefer the real "rating" field (simple average) over "bayesian_rating" (smoothed
      // toward the global mean). Bayesian compresses the spread which makes high-vote
      // niche works look more average than they are.
      const rating = typeof rec.rating === "number"
        ? rec.rating
        : typeof rec.bayesian_rating === "number" ? rec.bayesian_rating : undefined
      const votes = typeof rec.rating_votes === "number" ? rec.rating_votes : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genres = (rec.genres ?? []).map((g: any) => (g.genre ?? g) as string).filter(Boolean)
      const associatedTitles = (rec.associated ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => (item.title ?? item) as string)
      const alternativeTitles = uniqueTitles([item.hit_title, ...associatedTitles], rec.title)
      return {
        id: `mu:${rec.series_id}`,
        source: "mangaupdates" as const,
        title: rec.title ?? "",
        alternativeTitles: alternativeTitles.length > 0 ? alternativeTitles : undefined,
        synopsis: cleanHtml(rec.description),
        coverUrl: rec.image?.url?.original ?? undefined,
        year: rec.year ? parseInt(rec.year) : undefined,
        publicationStatus: mapStatus(rec.status),
        score: rating,
        votes,
        genres: genres.length > 0 ? genres : undefined,
      }
    })
  } catch {
    return []
  }
}

export interface MangaUpdatesDetail {
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  publicationStatus: PublicationStatus
  chapters?: number
  genres: string[]
  categories: string[]
  rating?: number
  votes?: number
  /** Texto cru de "Status in Country of Origin" — preservado pra exibir/anotar
   * info que `mapStatus` (enum) e `parseChaptersFromStatus` descartam. */
  statusText?: string
}

export async function fetchMangaUpdatesReviews(id: number): Promise<string[]> {
  try {
    const detailRes = await fetch(`${MU_BASE}/series/${id}`, {
      cache: "no-store",
      headers: MU_HEADERS,
    })
    if (!detailRes.ok) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail: any = await detailRes.json()
    const pageUrl = typeof detail?.url === "string" ? detail.url : null
    if (!pageUrl) return []

    const url = new URL(pageUrl)
    url.searchParams.set("perpage", "50")
    url.searchParams.set("method", "useful")

    const pageRes = await fetch(url, {
      cache: "no-store",
      headers: MU_HEADERS,
    })
    if (!pageRes.ok) return []

    const html = await pageRes.text()
    return parseMangaUpdatesComments(html)
      .map((comment) => comment.slice(0, 900))
  } catch {
    return []
  }
}

/**
 * MU's API does NOT expose the simple-average rating — only `bayesian_rating` (smoothed
 * toward the global mean) and the vote count. The web page in contrast renders both:
 * "Average: 6.9" (simple) AND "Bayesian Average: 6.68". This scrape pulls the simple
 * average from the HTML to give a more honest signal for niche works.
 */
async function scrapeMangaUpdatesAverage(seriesUrl: string): Promise<number | undefined> {
  try {
    const res = await fetch(seriesUrl, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (!res.ok) return undefined
    const html = await res.text()
    const match = html.match(/Average:\s*(?:<!--\s*-->\s*)?(\d+(?:\.\d+)?)/i)
    if (!match) return undefined
    const value = parseFloat(match[1])
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Lightweight alt-titles fetch — usado pelo refinamento de busca pra obter
 * `associated[]` (que NÃO vem na resposta da search API, apenas no detail).
 * Pula o scrape de rating do `fetchMangaUpdatesById` pra evitar latência
 * desnecessária quando só queremos os títulos alternativos.
 */
export async function fetchMangaUpdatesAlternativeTitles(id: number): Promise<string[]> {
  try {
    const res = await fetch(`${MU_BASE}/series/${id}`, { cache: "no-store" })
    if (!res.ok) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const associated: unknown[] = (data?.associated ?? []).map((item: any) => item?.title)
    return associated.filter((title): title is string => typeof title === "string" && Boolean(title.trim()))
  } catch {
    return []
  }
}

export async function fetchMangaUpdatesById(id: number): Promise<MangaUpdatesDetail | null> {
  try {
    const res = await fetch(`${MU_BASE}/series/${id}`, {
      cache: "no-store",
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const bayesian = typeof data.bayesian_rating === "number" ? data.bayesian_rating : undefined
    const realAvg = typeof data.url === "string" ? await scrapeMangaUpdatesAverage(data.url) : undefined
    // Prefer the real (simple) average from the page; fall back to bayesian when
    // scraping is blocked (Cloudflare/rate-limited) or the layout changes.
    const rating = realAvg ?? bayesian
    const votes = typeof data.rating_votes === "number" ? data.rating_votes : undefined

    return {
      title: data.title ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alternativeTitles: (data.associated ?? []).map((item: any) => item.title as string).filter(Boolean),
      synopsis: cleanHtml(data.description),
      coverUrl: data.image?.url?.original ?? undefined,
      year: data.year ? parseInt(data.year) : undefined,
      publicationStatus: mapStatus(data.status),
      chapters: parseChaptersFromStatus(data.status) ?? (typeof data.latest_chapter === "number" ? data.latest_chapter : undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      genres: (data.genres ?? []).map((g: any) => g.genre as string),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: (data.categories ?? []).map((c: any) => c.category as string),
      rating,
      votes,
      statusText: typeof data.status === "string" ? data.status : undefined,
    }
  } catch {
    return null
  }
}
