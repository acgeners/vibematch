import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback } from "./flaresolverr"

const AP_BASE = "https://www.anime-planet.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
}

export interface AnimePlanetDetail {
  rating?: number  // 0–10 (converted from AP's 0–5)
  votes?: number
  coverUrl?: string
  synopsis?: string
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
    .replace(/&#039;/g, "'")
    .trim() || undefined
}

function decodeHtml(text: string | undefined): string | undefined {
  return cleanHtml(text)
}

function mapStatus(text: string | undefined): PublicationStatus | undefined {
  if (!text) return undefined
  const value = text.toLowerCase()
  if (value.includes("finished") || value.includes("complete")) return "Completed"
  if (value.includes("hiatus")) return "Hiatus"
  if (value.includes("cancel") || value.includes("dropped")) return "Cancelled"
  if (value.includes("releasing") || value.includes("ongoing")) return "Ongoing"
  return undefined
}

function extractYear(text: string | undefined): number | undefined {
  const match = text?.match(/\b(19\d{2}|20\d{2})\b/)
  return match ? Number(match[1]) : undefined
}

function hasExcludedTitleSuffix(title: string | undefined) {
  return /\s\((?:Novel|Promo|Pre-serialization)\)$/.test(title?.trim() ?? "")
}

async function findSlug(title: string): Promise<string | null> {
  const url = `${AP_BASE}/manga/all?name=${encodeURIComponent(title)}`
  const result = await fetchHtmlWithCfFallback(url, HEADERS)
  if (!result) return null

  // AP collapses single-result searches via 302 to the detail page.
  const META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])
  const directMatch = result.finalUrl.match(/\/manga\/([a-z0-9][a-z0-9-]*)\/?$/)
  if (directMatch && !META.has(directMatch[1])) return directMatch[1]

  // Capture slug + title attribute to filter "(Novel)" entries by display name
  const slugRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = slugRegex.exec(result.html)) !== null) {
    const [, slug, title] = match
    if (!META.has(slug) && !hasExcludedTitleSuffix(title)) return slug
  }
  return null
}

export async function searchAnimePlanet(search: string): Promise<ExternalSearchResult[]> {
  try {
    const result = await fetchHtmlWithCfFallback(
      `${AP_BASE}/manga/all?name=${encodeURIComponent(search)}`,
      HEADERS
    )
    if (!result) return []
    const html = result.html

    const results: ExternalSearchResult[] = []
    const seen = new Set<string>()
    const META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])
    const cardRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"([\s\S]*?)(?=href="\/manga\/[a-z0-9][a-z0-9-]*"|<\/ul>|<\/section>|$)/g

    let match: RegExpExecArray | null
    while ((match = cardRegex.exec(html)) !== null && results.length < 8) {
      const [, slug, rawTitle, chunk] = match
      if (META.has(slug) || hasExcludedTitleSuffix(rawTitle) || seen.has(slug)) continue
      seen.add(slug)

      const img = chunk.match(/data-src="([^"]+)"|src="([^"]+)"/)
      const coverPath = img?.[1] ?? img?.[2]
      const synopsis = cleanHtml(chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1])
      const statusText = cleanHtml(chunk.match(/(?:Status|Release):?<\/[^>]+>\s*<[^>]+>([^<]+)/i)?.[1])
      const title = decodeHtml(rawTitle) ?? rawTitle
      const genres = [...chunk.matchAll(/\/manga\/(?:tags|genres)\/[^"]+"[^>]*>([^<]+)/g)]
        .map((genre) => decodeHtml(genre[1]))
        .filter((genre): genre is string => Boolean(genre))

      results.push({
        id: `animeplanet:${slug}`,
        source: "animeplanet",
        title,
        synopsis,
        coverUrl: coverPath ? new URL(coverPath, AP_BASE).toString() : undefined,
        year: extractYear(chunk),
        publicationStatus: mapStatus(statusText),
        genres: genres.length > 0 ? genres : undefined,
      })
    }

    return results
  } catch {
    return []
  }
}

/**
 * Scrapes user reviews from `/manga/{slug}/reviews`. AP usa schema.org markup:
 *   <div itemprop="reviewBody" class="userContent readMore" ...>
 *     <p>...</p><p>...</p>
 *   </div>
 *
 * Rating extraído do contexto HTML antes de cada reviewBody:
 *   1. itemprop="ratingValue" content="X.X"  (schema.org, 0-5)
 *   2. fallback: contagem de iconStarFull     (0-5 inteiro)
 * Convertido para 0-10 e prefixado como "Nota do usuário: X/10\n" para que
 * extractUserRating() no pipeline de coleta possa parsear.
 *
 * CF protege — caímos no FlareSolverr quando o fetch direto for bloqueado.
 */
export async function fetchAnimePlanetReviews(slug: string, limit = Infinity): Promise<string[]> {
  try {
    const result = await fetchHtmlWithCfFallback(
      `${AP_BASE}/manga/${slug}/reviews`,
      HEADERS
    )
    if (!result) return []

    const html = result.html
    const bodyRegex = /<div[^>]+itemprop="reviewBody"[^>]*>([\s\S]*?)<\/div>/gi
    const reviews: string[] = []

    for (const match of html.matchAll(bodyRegex)) {
      if (reviews.length >= limit) break
      const text = cleanHtml(match[1])
      if (!text || text.length < 100) continue

      // Olha 2000 chars antes deste bloco para encontrar o rating da review
      const lookback = html.slice(Math.max(0, (match.index ?? 0) - 2000), match.index ?? 0)
      const ratingValueMatch = lookback.match(/itemprop="ratingValue"[^>]*content="([0-9.]+)"/)
      const starsFull = (lookback.match(/iconStarFull/g) ?? []).length

      let prefix = ""
      if (ratingValueMatch) {
        const raw = parseFloat(ratingValueMatch[1])
        if (Number.isFinite(raw) && raw >= 0.5 && raw <= 5) {
          prefix = `Nota do usuário: ${Math.round(raw * 2 * 10) / 10}/10\n`
        }
      } else if (starsFull >= 1 && starsFull <= 5) {
        prefix = `Nota do usuário: ${starsFull * 2}/10\n`
      }

      reviews.push(`${prefix}${text}`)
    }

    return reviews
  } catch {
    return []
  }
}

export async function fetchAnimePlanetByTitle(title: string, knownSlug?: string): Promise<AnimePlanetDetail | null> {
  try {
    const slug = knownSlug ?? await findSlug(title)
    if (!slug) return null

    const result = await fetchHtmlWithCfFallback(`${AP_BASE}/manga/${slug}`, HEADERS)
    if (!result) return null
    const html = result.html

    // <div class="avgRating" title="3.872 out of 5 from 819 votes">
    const ratingMatch = html.match(/class="avgRating"[^>]*title="([\d.]+) out of 5 from ([\d,]+) votes"/)
    const rawRating = ratingMatch ? parseFloat(ratingMatch[1]) : NaN
    const rawVotes = ratingMatch ? parseInt(ratingMatch[2].replace(/,/g, ""), 10) : NaN

    // og:image is the canonical large cover URL. Fall back to first <img class="screenshots"> if absent.
    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1]
    const fallbackImage = ogImage ? undefined : html.match(/<img[^>]+class="[^"]*screenshots?[^"]*"[^>]+src="([^"]+)"/i)?.[1]
    const coverPath = ogImage ?? fallbackImage
    const coverUrl = coverPath ? new URL(coverPath, AP_BASE).toString() : undefined

    // og:description carries the full synopsis on AP detail pages.
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1]
    const synopsis = ogDesc ? cleanHtml(ogDesc) : undefined

    // Return the detail even when rating is unavailable — cover/synopsis alone are useful signals.
    if (!ratingMatch && !coverUrl && !synopsis) return null

    return {
      rating: !isNaN(rawRating) ? Math.round(rawRating * 2 * 10) / 10 : undefined,
      votes: !isNaN(rawVotes) ? rawVotes : undefined,
      coverUrl,
      synopsis,
    }
  } catch {
    return null
  }
}
