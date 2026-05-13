import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const AP_BASE = "https://www.anime-planet.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
}

export interface AnimePlanetDetail {
  rating?: number  // 0–10 (converted from AP's 0–5)
  votes?: number
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
  const res = await fetch(url, { cache: "no-store", headers: HEADERS })
  if (!res.ok) return null
  const html = await res.text()

  // Search results have cards with href="/manga/{slug}" — skip meta-paths
  const META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])
  // Capture slug + title attribute to filter "(Novel)" entries by display name
  const slugRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = slugRegex.exec(html)) !== null) {
    const [, slug, title] = match
    if (!META.has(slug) && !hasExcludedTitleSuffix(title)) return slug
  }
  return null
}

export async function searchAnimePlanet(search: string): Promise<ExternalSearchResult[]> {
  try {
    const res = await fetch(`${AP_BASE}/manga/all?name=${encodeURIComponent(search)}`, {
      cache: "no-store",
      headers: HEADERS,
    })
    if (!res.ok) return []
    const html = await res.text()
    if (/cf-mitigated|challenge-platform|Just a moment/i.test(html)) return []

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

export async function fetchAnimePlanetByTitle(title: string, knownSlug?: string): Promise<AnimePlanetDetail | null> {
  try {
    const slug = knownSlug ?? await findSlug(title)
    if (!slug) return null

    const res = await fetch(`${AP_BASE}/manga/${slug}`, {
      cache: "no-store",
      headers: HEADERS,
    })
    if (!res.ok) return null
    const html = await res.text()

    // <div class="avgRating" title="3.872 out of 5 from 819 votes">
    const m = html.match(/class="avgRating"[^>]*title="([\d.]+) out of 5 from ([\d,]+) votes"/)
    if (!m) return null

    const raw = parseFloat(m[1])
    const votes = parseInt(m[2].replace(/,/g, ""), 10)

    return {
      rating: !isNaN(raw) ? Math.round(raw * 2 * 10) / 10 : undefined,
      votes: !isNaN(votes) ? votes : undefined,
    }
  } catch {
    return null
  }
}
