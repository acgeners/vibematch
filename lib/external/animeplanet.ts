import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isFlareSolverrCircuitOpen } from "./flaresolverr"

const AP_BASE = "https://www.anime-planet.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Referer": `${AP_BASE}/manga/all`,
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
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
    .replace(/&apos;/g, "'")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, "...")
    .replace(/&#(?:039|x27);/gi, "'")
    .trim() || undefined
}

function decodeHtml(text: string | undefined): string | undefined {
  return cleanHtml(text)
}

function decodeHtmlAttribute(text: string | undefined): string | undefined {
  if (!text) return undefined
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, "...")
    .replace(/&#(?:039|x27);/gi, "'")
    .trim() || undefined
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

// AP usa convenção de slug com sufixo `-novel`, `-promo`, `-pre-serialization`
// pra distinguir versões. Quando só temos o slug (sem fetch da detail page),
// usamos isso como heurística rápida pra evitar pegar a versão errada.
function hasExcludedSlugSuffix(slug: string | undefined) {
  return /-(?:novel|promo|pre-serialization)$/.test(slug?.trim() ?? "")
}

function normalizeTitleForMatch(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function titleLooksCompatible(search: string, title: string | undefined): boolean {
  const query = normalizeTitleForMatch(search)
  const candidate = normalizeTitleForMatch(title)
  if (!query || !candidate) return false
  if (query === candidate) return true
  if (candidate.includes(query)) return true
  if (query.includes(candidate) && candidate.length / query.length >= 0.75) return true

  const queryWords = new Set(query.split(" ").filter((word) => word.length > 2))
  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 2))
  if (!queryWords.size || !candidateWords.size) return false
  const intersection = [...queryWords].filter((word) => candidateWords.has(word)).length
  return intersection / new Set([...queryWords, ...candidateWords]).size >= 0.8
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function directSlugCandidates(title: string): string[] {
  const slug = slugifyTitle(title)
  const withoutLeadingArticle = slug.replace(/^(?:the|a|an)-/, "")
  return [...new Set([slug, withoutLeadingArticle].filter(Boolean))]
}

async function fetchDirectSearchResult(search: string): Promise<ExternalSearchResult | null> {
  for (const slug of directSlugCandidates(search)) {
    const result = await fetchHtmlWithCfFallback(`${AP_BASE}/manga/${slug}`, HEADERS)
    if (!result) continue
    const parsed = parseDetailPageAsSearchResult(result.html, slug)
    if (!parsed) continue
    if (hasExcludedTitleSuffix(parsed.title)) continue
    if (titleLooksCompatible(search, parsed.title)) return parsed
  }
  return null
}

async function findSlug(title: string): Promise<string | null> {
  const url = `${AP_BASE}/manga/all?name=${encodeURIComponent(title)}`
  const result = await fetchHtmlWithCfFallback(url, HEADERS)
  if (!result) {
    const direct = await fetchDirectSearchResult(title)
    return direct?.id.split(":")[1] ?? null
  }

  // AP collapses single-result searches via 302 to the detail page.
  const META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])
  const directMatch = result.finalUrl.match(/\/manga\/([a-z0-9][a-z0-9-]*)\/?$/)
  if (directMatch && !META.has(directMatch[1]) && !hasExcludedSlugSuffix(directMatch[1])) {
    return directMatch[1]
  }

  // Capture slug + title attribute to filter "(Novel)" entries by display name
  const slugRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = slugRegex.exec(result.html)) !== null) {
    const [, slug, title] = match
    if (META.has(slug) || hasExcludedSlugSuffix(slug) || hasExcludedTitleSuffix(title)) continue
    return slug
  }
  const direct = await fetchDirectSearchResult(title)
  return direct?.id.split(":")[1] ?? null
}

export async function searchAnimePlanet(search: string): Promise<ExternalSearchResult[]> {
  // anime-planet.com é Cloudflare-gated; sem FlareSolverr (circuito aberto) os
  // fetches só voltam o desafio CF (~5s à toa, 0 resultado). Pula rápido.
  if (isFlareSolverrCircuitOpen()) return []
  try {
    const result = await fetchHtmlWithCfFallback(
      `${AP_BASE}/manga/all?name=${encodeURIComponent(search)}`,
      HEADERS
    )
    if (!result) {
      const direct = await fetchDirectSearchResult(search)
      return direct ? [direct] : []
    }
    const html = result.html

    const results: ExternalSearchResult[] = []
    const seen = new Set<string>()
    const META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])

    // AP collapses single-result searches via 302 to the detail page (mesmo
    // comportamento já tratado em findSlug). Sem isso, cardRegex não casa nada
    // na HTML de detalhes e a função devolve [].
    //
    // CUIDADO: se o AP redirecionou pra página da Novel (existe Novel + Manhwa),
    // o suffix "(Novel)" precisa ser filtrado aqui — caso contrário a Novel
    // passa adiante. Quando filtramos, caímos no fetchDirectSearchResult abaixo
    // que tenta o slug canônico do título (sem -novel) e pega o Manhwa.
    const directMatch = result.finalUrl.match(/\/manga\/([a-z0-9][a-z0-9-]*)\/?$/)
    if (directMatch && !META.has(directMatch[1]) && !hasExcludedSlugSuffix(directMatch[1])) {
      const single = parseDetailPageAsSearchResult(html, directMatch[1])
      if (single && !hasExcludedTitleSuffix(single.title) && titleLooksCompatible(search, single.title)) {
        return [single]
      }
    }

    const cardRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"([\s\S]*?)(?=href="\/manga\/[a-z0-9][a-z0-9-]*"|<\/ul>|<\/section>|$)/g

    let match: RegExpExecArray | null
    while ((match = cardRegex.exec(html)) !== null && results.length < 8) {
      const [, slug, rawTitle, chunk] = match
      if (META.has(slug) || hasExcludedSlugSuffix(slug) || hasExcludedTitleSuffix(rawTitle) || seen.has(slug)) continue
      seen.add(slug)

      const dataSrc = chunk.match(/data-src="([^"]+)"/)?.[1]
      const rawSrc = chunk.match(/<img[^>]+\ssrc="([^"]+)"/)?.[1]
      const coverPath =
        dataSrc && !dataSrc.startsWith("data:")
          ? dataSrc
          : rawSrc && !rawSrc.startsWith("data:")
            ? rawSrc
            : undefined
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

    if (results.length > 0) return results

    const direct = await fetchDirectSearchResult(search)
    return direct ? [direct] : []
  } catch {
    return []
  }
}

function parseDetailPageAsSearchResult(
  html: string,
  slug: string
): ExternalSearchResult | null {
  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1]
  const title = decodeHtml(ogTitle)
  if (!title) return null

  const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1]
  const synopsis = ogDesc ? cleanHtml(ogDesc) : undefined

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1]
  const coverUrl = ogImage ? new URL(ogImage, AP_BASE).toString() : undefined

  // Year/status na AP ficam em microformatos no HTML, não em meta tags.
  // Heurística leve; se falhar fica undefined (UI da revalidação só precisa
  // de title + cover pra score e exibição).
  const yearMatch =
    html.match(/<span[^>]*class="iconYear"[^>]*>[\s\S]*?(\d{4})/) ??
    html.match(/\b(19\d{2}|20\d{2})\b\s*-\s*(?:\?|\d{4})?/)
  const year = yearMatch ? Number(yearMatch[1]) : undefined

  const statusText = html.match(/Status[:\s]*<\/[^>]+>\s*<[^>]*>([^<]+)/i)?.[1]
  const publicationStatus = mapStatus(statusText)

  return {
    id: `animeplanet:${slug}`,
    source: "animeplanet",
    title,
    synopsis,
    coverUrl,
    year,
    publicationStatus,
    genres: undefined,
  }
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = parseFloat(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : undefined
}

function integerValue(value: unknown): number | undefined {
  const parsed = numericValue(value)
  return parsed == null ? undefined : Math.floor(parsed)
}

function findAggregateRating(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findAggregateRating(entry)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  const aggregate = record.aggregateRating
  if (aggregate && typeof aggregate === "object") return aggregate as Record<string, unknown>

  for (const entry of Object.values(record)) {
    const found = findAggregateRating(entry)
    if (found) return found
  }
  return null
}

function parseJsonLdAggregateRating(html: string): { rating?: number; votes?: number } {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    try {
      const jsonText = decodeHtmlAttribute(match[1])
      if (!jsonText) continue
      const aggregate = findAggregateRating(JSON.parse(jsonText))
      if (!aggregate) continue
      return {
        rating: numericValue(aggregate.ratingValue),
        votes: integerValue(aggregate.ratingCount ?? aggregate.reviewCount),
      }
    } catch {
      continue
    }
  }
  return {}
}

function parseAnimePlanetRating(html: string): { rating?: number; votes?: number } {
  const avgRatingMatch = html.match(/class=["'][^"']*avgRating[^"']*["'][^>]*title=["']([\d.]+) out of 5 from ([\d,]+) votes["']/i)
  if (avgRatingMatch) {
    return {
      rating: numericValue(avgRatingMatch[1]),
      votes: integerValue(avgRatingMatch[2]),
    }
  }

  const schemaRating = html.match(/itemprop=["']ratingValue["'][^>]*content=["']([0-9.]+)["']/i)
  const schemaVotes = html.match(/itemprop=["'](?:ratingCount|reviewCount)["'][^>]*content=["']([\d,]+)["']/i)
  if (schemaRating || schemaVotes) {
    return {
      rating: numericValue(schemaRating?.[1]),
      votes: integerValue(schemaVotes?.[1]),
    }
  }

  const jsonLd = parseJsonLdAggregateRating(html)
  if (jsonLd.rating != null || jsonLd.votes != null) return jsonLd

  const looseRating = html.match(/["']ratingValue["']\s*:\s*["']?([0-9.]+)/i)
  const looseVotes = html.match(/["'](?:ratingCount|reviewCount)["']\s*:\s*["']?([\d,]+)/i)
  return {
    rating: numericValue(looseRating?.[1]),
    votes: integerValue(looseVotes?.[1]),
  }
}

export function parseAnimePlanetDetailHtml(html: string): AnimePlanetDetail | null {
  const parsedRating = parseAnimePlanetRating(html)
  const rawRating = parsedRating.rating
  const rawVotes = parsedRating.votes

  // og:image is the canonical large cover URL. Fall back to first <img class="screenshots"> if absent.
  const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]
  const fallbackImage = ogImage ? undefined : html.match(/<img[^>]+class=["'][^"']*screenshots?[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1]
  const coverPath = ogImage ?? fallbackImage
  const coverUrl = coverPath ? new URL(coverPath, AP_BASE).toString() : undefined

  // og:description carries the full synopsis on AP detail pages.
  const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1]
  const synopsis = ogDesc ? cleanHtml(decodeHtmlAttribute(ogDesc)) : undefined

  // Return the detail even when rating is unavailable — cover/synopsis alone are useful signals.
  if (rawRating == null && rawVotes == null && !coverUrl && !synopsis) return null

  return {
    rating: rawRating != null ? Math.round(rawRating * 2 * 10) / 10 : undefined,
    votes: rawVotes,
    coverUrl,
    synopsis,
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
  if (isFlareSolverrCircuitOpen()) return []
  try {
    const url = `${AP_BASE}/manga/${slug}/reviews`
    const result = await fetchHtmlWithCfFallback(url, HEADERS)
    if (!result) {
      console.warn(`[fetchAnimePlanetReviews] AP slug="${slug}": fetch falhou (CF/FlareSolverr não resolveu) ${url}`)
      return []
    }

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

    if (reviews.length === 0) {
      const blocks = (html.match(/itemprop="reviewBody"/g) ?? []).length
      console.warn(`[fetchAnimePlanetReviews] AP slug="${slug}": 0 reviews extraídas (reviewBody encontrados=${blocks}, HTML ${html.length} chars)`)
    }
    return reviews
  } catch (err) {
    console.warn(`[fetchAnimePlanetReviews] AP slug="${slug}" falhou:`, err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Scrapes "If you liked X, you might like..." from `/manga/{slug}/recommendations`.
 * Returns titles only — AnimePlanet's recommendation page links to other manga
 * pages without exposing genres/tags inline (would require N additional fetches).
 *
 * Heuristic: tries to find the recommendations section first, then pulls manga
 * links with a `title` attribute. Falls back to all manga links on the page,
 * with the source slug filtered out. Defensive — returns [] on any parse error.
 */
export async function fetchAnimePlanetRecommendations(slug: string): Promise<string[]> {
  if (isFlareSolverrCircuitOpen()) return []
  try {
    const result = await fetchHtmlWithCfFallback(
      `${AP_BASE}/manga/${slug}/recommendations`,
      HEADERS
    )
    if (!result) return []

    const html = result.html
    const sectionMatch = html.match(/<section[^>]*class="[^"]*recommendation[^"]*"[\s\S]*?<\/section>/i)
    const scope = sectionMatch?.[0] ?? html

    const titles: string[] = []
    const seen = new Set<string>()
    const linkRegex = /<a[^>]+href="\/manga\/([^"/]+)"[^>]*title="([^"]+)"/gi

    for (const match of scope.matchAll(linkRegex)) {
      const recSlug = match[1]
      if (!recSlug || recSlug === slug) continue
      if (seen.has(recSlug)) continue
      seen.add(recSlug)
      const title = decodeHtmlAttribute(match[2])
      if (title) titles.push(title)
      if (titles.length >= 10) break
    }

    return titles
  } catch {
    return []
  }
}

export async function fetchAnimePlanetByTitle(title: string, knownSlug?: string): Promise<AnimePlanetDetail | null> {
  if (isFlareSolverrCircuitOpen()) return null
  try {
    const slug = knownSlug ?? await findSlug(title)
    if (!slug) return null

    const result = await fetchHtmlWithCfFallback(`${AP_BASE}/manga/${slug}`, HEADERS)
    if (!result) return null
    return parseAnimePlanetDetailHtml(result.html)
  } catch {
    return null
  }
}
