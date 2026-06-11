import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isCloudflareChallenge, isFlareSolverrEnabled, isFlareSolverrCircuitOpen } from "./flaresolverr"

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

  // comix.to é sempre CF-protegido; sem FlareSolverr não há como passar. Quando
  // o circuito está aberto (container fora), pula tudo — inclusive o fetch direto
  // inútil — pra não somar segundos em cada chamada (a busca chama comix N×).
  if (isFlareSolverrEnabled() && isFlareSolverrCircuitOpen()) return null

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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, " ")
}

function stripHtmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

/**
 * Comentários do thread de NÍVEL-OBRA (a aba de comentários da página inicial da
 * obra no comix.to, não atrelada a capítulo). A comix não tem "reviews" formais;
 * esses comentários funcionam como mini-reviews ("10/10 peak", "dropped at ch20…").
 *
 * Cadeia (descoberta por reverse-engineering do bundle do front — acessores
 * `Ve.threadLookup`/`Ve.thread`):
 *  1. detalhe → id interno numérico (page_identifier = "manga{id}")
 *  2. GET /threads/lookup?page_identifier=…&page_url=/title/{hid} → threadId
 *     (ambos os params são obrigatórios; o feed global /comments NÃO filtra por obra)
 *  3. GET /threads/{threadId}/comments (paginado por cursor) → items[].contentHtml
 * Tudo via `fetchComixJson` pra herdar o fallback FlareSolverr do Cloudflare.
 */
export async function fetchComixReviews(hid: string): Promise<string[]> {
  const detail = await fetchComixJson(`/manga/${encodeURIComponent(hid)}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internalId = (detail as any)?.result?.id
  if (typeof internalId !== "number") return []

  const lookupPath = `/threads/lookup?page_identifier=manga${internalId}&page_url=${encodeURIComponent(`/title/${hid}`)}`
  const lookup = await fetchComixJson(lookupPath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadId = (lookup as any)?.result?.thread?.id
  if (typeof threadId !== "number" || threadId <= 0) return []

  const texts: string[] = []
  let cursor: string | undefined
  // 2 páginas (~44 comentários de topo) bastam: o seletor a jusante
  // (`selectReviewsForEvaluation`) corta por fonte de qualquer forma.
  for (let page = 0; page < 2; page++) {
    const path = `/threads/${threadId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    const data = await fetchComixJson(path)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (data as any)?.result
    const items: unknown[] = Array.isArray(result?.items) ? result.items : []
    for (const item of items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any
      if (it?.isBanned || it?.isShadowBanned) continue
      if (typeof it?.status === "string" && it.status !== "visible") continue
      if (typeof it?.contentHtml === "string") {
        // Trunca em 900 chars como as outras fontes (mangaupdates/comick/…) pra
        // não inflar tokens nem enviesar o ranking por textLength a jusante.
        const text = stripHtmlToText(it.contentHtml).slice(0, 900)
        if (text) texts.push(text)
      }
    }
    cursor = typeof result?.cursor === "string" && result.cursor ? result.cursor : undefined
    if (!cursor || items.length === 0) break
  }
  return texts
}
