import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const COMICK_BASES = [
  "https://api.comick.io",
  "https://comick.dev",
  "https://api.comick.app",
]

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://comick.io/",
  Origin: "https://comick.io",
}

function mapStatus(status: number | undefined): PublicationStatus {
  switch (status) {
    case 1: return "Ongoing"
    case 2: return "Completed"
    case 3: return "Hiatus"
    case 4: return "Cancelled"
    default: return "Unknown"
  }
}

function coverUrl(b2key: string | undefined): string | undefined {
  if (!b2key) return undefined
  return `https://meo.comick.pictures/${b2key}`
}

export interface ComicKDetail {
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  publicationStatus: PublicationStatus
  lastChapter?: number
  rating?: number
  votes?: number
  tags: string[]
}

function cleanText(value: unknown): string | undefined {
  const text = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

async function fetchJson(pathname: string, search = "") {
  for (const base of COMICK_BASES) {
    try {
      const url = new URL(pathname, base)
      url.search = search
      const res = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
      })
      if (!res.ok) continue
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("json")) continue
      return await res.json()
    } catch {
      continue
    }
  }

  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tagsFromComic(comic: any): string[] {
  const rawTags: unknown[] = Array.isArray(comic?.md_tags) ? comic.md_tags : []
  return Array.from(new Set(rawTags
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((tag: any) => tag?.md_tag?.name ?? tag?.name)
    .filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim()))
    .map((tag) => tag.trim())))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function alternativeTitlesFromComic(comic: any, primary: string): string[] {
  const values = [
    ...(Array.isArray(comic?.md_titles)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? comic.md_titles.map((entry: any) => entry?.title)
      : []),
    ...(Array.isArray(comic?.mu_comics?.associated)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? comic.mu_comics.associated.map((entry: any) => entry?.title ?? entry)
      : []),
  ]
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim())
    .filter((value) => value.toLowerCase() !== primary.toLowerCase())))
}

export async function searchComicK(search: string): Promise<ExternalSearchResult[]> {
  try {
    const url = new URL("/v1.0/search/", COMICK_BASES[0])
    url.searchParams.set("q", search)
    url.searchParams.set("limit", "5")
    url.searchParams.set("type", "comic")
    const data = await fetchJson(url.pathname, url.search)
    const rows: unknown[] = Array.isArray(data) ? data : []

    return rows
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any): ExternalSearchResult | null => {
        const hid = item?.hid
        const title = item?.title
        if (typeof hid !== "string" || typeof title !== "string") return null
        return {
          id: `comick:${hid}`,
          source: "comick",
          title,
          alternativeTitles: alternativeTitlesFromComic(item, title),
          synopsis: cleanText(item?.desc ?? item?.description),
          coverUrl: coverUrl(item?.md_covers?.[0]?.b2key),
          publicationStatus: mapStatus(item?.status),
          chapters: item?.last_chapter != null ? Math.floor(parseFloat(String(item.last_chapter))) : undefined,
          score: item?.rating != null
            ? parseFloat(String(item.rating))
            : item?.bayesian_rating != null ? parseFloat(String(item.bayesian_rating)) : undefined,
          votes: typeof item?.rating_count === "number" ? item.rating_count : item?.follow_count,
          genres: tagsFromComic(item),
        }
      })
      .filter((item): item is ExternalSearchResult => item !== null)
  } catch {
    return []
  }
}

export async function fetchComicKByHid(hid: string): Promise<ComicKDetail | null> {
  try {
    const data = await fetchJson(`/comic/${hid}`)
    if (!data) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = data
    const comic = raw?.comic ?? raw

    // Prefer real "rating" (simple mean) over "bayesian_rating" (smoothed).
    const rawRating = comic.rating ?? comic.bayesian_rating
    const rating = rawRating != null ? parseFloat(String(rawRating)) : undefined
    const rawChapter = comic.last_chapter
    const lastChapter = rawChapter != null ? Math.floor(parseFloat(String(rawChapter))) : undefined
    const title = comic.title ?? ""
    return {
      title,
      alternativeTitles: alternativeTitlesFromComic(comic, title),
      synopsis: cleanText(comic.desc ?? comic.description),
      coverUrl: coverUrl(comic.md_covers?.[0]?.b2key),
      publicationStatus: mapStatus(comic.status),
      lastChapter: lastChapter != null && !isNaN(lastChapter) ? lastChapter : undefined,
      rating: rating != null && !isNaN(rating) ? rating : undefined,
      votes: comic.rating_count ?? comic.follow_count ?? undefined,
      tags: tagsFromComic(comic),
    }
  } catch {
    return null
  }
}
