import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const COMIX_BASE = "https://comix.to/api/v1"

// The comix.to API only responds with full data when called as an XHR
// (same origin pattern). Without X-Requested-With the detail endpoint returns 404.
const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://comix.to/",
}

export interface ComixDetail {
  hid: string
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  publicationStatus?: PublicationStatus
  rating?: number
  votes?: number
  tags: string[]
  /** Cross-source IDs exposed by comix.to (anilist, mangaupdates, myanimelist, mangadex). */
  links?: { anilist?: string; mu?: string; mal?: string; md?: string }
}

function mapStatus(status: unknown): PublicationStatus {
  if (typeof status !== "string") return "Unknown"
  switch (status.toLowerCase()) {
    case "finished":
      return "Completed"
    case "ongoing":
    case "publishing":
      return "Ongoing"
    case "on_hiatus":
    case "hiatus":
      return "Hiatus"
    case "cancelled":
    case "discontinued":
      return "Cancelled"
    default:
      return "Unknown"
  }
}

function coverFromPoster(poster: unknown): string | undefined {
  if (!poster || typeof poster !== "object") return undefined
  const p = poster as { large?: string; medium?: string }
  return p.large ?? p.medium ?? undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tagsFromItem(item: any): string[] {
  const out: string[] = []
  for (const field of ["tags", "genres", "demographics"]) {
    const arr = item?.[field]
    if (!Array.isArray(arr)) continue
    for (const entry of arr) {
      const name = typeof entry === "string" ? entry : (entry?.name ?? entry?.label ?? entry?.tag ?? null)
      if (typeof name === "string" && name.trim()) out.push(name.trim())
    }
  }
  return Array.from(new Set(out))
}

function extractIdFromUrl(value: unknown, regex: RegExp): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const m = value.match(regex)
  return m?.[1]
}

function linksFromItem(links: unknown): ComixDetail["links"] {
  if (!links || typeof links !== "object") return undefined
  const l = links as Record<string, unknown>
  // comix.to surfaces full URLs (e.g. "https://anilist.co/manga/121439/"). Extract just the ID.
  const out: NonNullable<ComixDetail["links"]> = {
    anilist: extractIdFromUrl(l.al, /anilist\.co\/manga\/(\d+)/i),
    mal: extractIdFromUrl(l.mal, /myanimelist\.net\/manga\/(\d+)/i),
    mu: extractIdFromUrl(l.mu, /mangaupdates\.com\/series\/([a-z0-9]+)/i),
    md: extractIdFromUrl(l.md, /mangadex\.org\/title\/([0-9a-f-]+)/i),
  }
  const cleaned: NonNullable<ComixDetail["links"]> = {}
  for (const [k, v] of Object.entries(out)) {
    if (v) (cleaned as Record<string, string>)[k] = v
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}

export async function searchComix(query: string): Promise<ExternalSearchResult[]> {
  try {
    const url = `${COMIX_BASE}/manga?keyword=${encodeURIComponent(query)}&limit=8`
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" })
    if (!res.ok) return []
    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = data?.result?.items ?? []
    return items
      .filter((item) => item?.hid && item?.title)
      .map((item): ExternalSearchResult => {
        const links = linksFromItem(item.links)
        const crossIds: Partial<Record<import("./types").ExternalSourceId, string>> = {}
        if (links?.anilist) crossIds.anilist = links.anilist
        if (links?.mal) crossIds.myanimelist = links.mal
        if (links?.mu) crossIds.mangaupdates = links.mu
        if (links?.md) crossIds.mangadex = links.md
        return {
          id: `comix:${item.hid}`,
          source: "comix",
          title: item.title,
          alternativeTitles: Array.isArray(item.altTitles)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? item.altTitles.map((t: any) => (typeof t === "string" ? t : t?.title)).filter(Boolean)
            : undefined,
          synopsis: typeof item.synopsis === "string" ? item.synopsis : undefined,
          coverUrl: coverFromPoster(item.poster),
          year: typeof item.year === "number" ? item.year : undefined,
          chapters:
            typeof item.finalChapter === "number" && item.finalChapter > 0
              ? item.finalChapter
              : typeof item.latestChapter === "number" && item.latestChapter > 0
                ? item.latestChapter
                : undefined,
          publicationStatus: mapStatus(item.status),
          score: typeof item.ratedAvg === "number" ? item.ratedAvg : undefined,
          votes: typeof item.ratedCount === "number" ? item.ratedCount : undefined,
          genres: tagsFromItem(item),
          crossIds: Object.keys(crossIds).length > 0 ? crossIds : undefined,
        }
      })
  } catch {
    return []
  }
}

export async function fetchComixById(hid: string): Promise<ComixDetail | null> {
  try {
    const res = await fetch(`${COMIX_BASE}/manga/${encodeURIComponent(hid)}`, {
      headers: HEADERS,
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = await res.json()
    const r = data?.result
    if (!r || typeof r !== "object") return null

    return {
      hid: r.hid ?? hid,
      title: r.title ?? "",
      alternativeTitles: Array.isArray(r.altTitles)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? r.altTitles.map((t: any) => (typeof t === "string" ? t : t?.title)).filter(Boolean)
        : [],
      synopsis: typeof r.synopsis === "string" ? r.synopsis : undefined,
      coverUrl: coverFromPoster(r.poster),
      year: typeof r.year === "number" ? r.year : undefined,
      chapters:
        typeof r.finalChapter === "number" && r.finalChapter > 0
          ? r.finalChapter
          : typeof r.latestChapter === "number" && r.latestChapter > 0
            ? r.latestChapter
            : undefined,
      publicationStatus: mapStatus(r.status),
      rating: typeof r.ratedAvg === "number" ? r.ratedAvg : undefined,
      votes: typeof r.ratedCount === "number" ? r.ratedCount : undefined,
      tags: tagsFromItem(r),
      links: linksFromItem(r.links),
    }
  } catch {
    return null
  }
}
