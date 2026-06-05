import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isCloudflareChallenge, isFlareSolverrEnabled } from "./flaresolverr"

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

type ComixFailure = "cloudflare_challenge" | "http_error" | "json_parse_error" | "flaresolverr_unavailable" | "network_error"

function logComixFailure(url: string, reason: ComixFailure, detail?: string) {
  console.error(`[comix] ${reason} url=${url}${detail ? ` detail=${detail}` : ""}`)
}

// comix.to fica atrás do Cloudflare Challenge — fetch direto retorna 403/HTML.
// Mesmo padrão de comick.ts: tenta fetch normal, e se falhar com challenge,
// faz fallback via FlareSolverr (headless Chrome) extraindo JSON do <pre>.
async function fetchComixJson(path: string): Promise<unknown | null> {
  const url = `${COMIX_BASE}${path}`

  let directBodyLooksLikeChallenge = false
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" })
    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? ""
      if (contentType.includes("json")) {
        try {
          return await res.json()
        } catch (err) {
          logComixFailure(url, "json_parse_error", err instanceof Error ? err.message : String(err))
        }
      } else {
        const body = await res.text()
        directBodyLooksLikeChallenge = isCloudflareChallenge(body)
      }
    } else {
      const body = await res.text().catch(() => "")
      directBodyLooksLikeChallenge = isCloudflareChallenge(body)
      if (!directBodyLooksLikeChallenge) {
        logComixFailure(url, "http_error", `status=${res.status}`)
      }
    }
  } catch (err) {
    logComixFailure(url, "network_error", err instanceof Error ? err.message : String(err))
  }

  if (!isFlareSolverrEnabled()) {
    if (directBodyLooksLikeChallenge) logComixFailure(url, "flaresolverr_unavailable")
    return null
  }

  const fallback = await fetchHtmlWithCfFallback(url, HEADERS)
  if (!fallback) {
    logComixFailure(url, "cloudflare_challenge", "flaresolverr returned no response")
    return null
  }
  const preMatch = fallback.html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  const raw = (preMatch?.[1] ?? fallback.html).trim()
  try {
    return JSON.parse(raw)
  } catch (err) {
    logComixFailure(url, "json_parse_error", `after-flaresolverr: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
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
  /** Data (relativa, pré-formatada pela comix, ex.: "8mos ago") do último capítulo. */
  lastChapterAt?: string
  /** Cross-source IDs exposed by comix.to (anilist, mangaupdates, myanimelist, mangadex). */
  links?: { anilist?: string; mu?: string; mal?: string; md?: string }
}

/** URL canônica da obra no comix.to. Só o hid já resolve (sem precisar do slug). */
export function comixWorkUrl(hid: string): string {
  return `https://comix.to/title/${hid}`
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
  const data = await fetchComixJson(`/manga?keyword=${encodeURIComponent(query)}&limit=8`)
  if (!data) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = (data as any)?.result?.items ?? []
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
        lastChapterAt:
          typeof item.chapterUpdatedAtFormatted === "string" ? item.chapterUpdatedAtFormatted : undefined,
      }
    })
}

export async function fetchComixById(hid: string): Promise<ComixDetail | null> {
  const data = await fetchComixJson(`/manga/${encodeURIComponent(hid)}`)
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (data as any)?.result
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
    lastChapterAt: typeof r.chapterUpdatedAtFormatted === "string" ? r.chapterUpdatedAtFormatted : undefined,
    links: linksFromItem(r.links),
  }
}
