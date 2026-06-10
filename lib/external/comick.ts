import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isFlareSolverrEnabled } from "./flaresolverr"

const COMICK_BASES = [
  // api.comick.dev é o endpoint vivo (out 2026 em diante). api.comick.io
  // passou a redirecionar pra comick.dev (frontend, 404). Mantemos os
  // antigos como fallback caso voltem ao ar.
  "https://api.comick.dev",
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
  /** "safe" | "suggestive" | "erotica". */
  contentRating?: string
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
  // Coleta motivos da falha por base pra log único no fim — assim fica claro
  // se foi Cloudflare 403 (precisa FlareSolverr) vs network error vs JSON inválido.
  const failures: string[] = []
  for (const base of COMICK_BASES) {
    const url = new URL(pathname, base)
    url.search = search
    let directReason: string | undefined
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
      })
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? ""
        if (contentType.includes("json")) return await res.json()
        directReason = `non-json content-type=${contentType || "(none)"}`
      } else {
        directReason = `HTTP ${res.status}`
      }
    } catch (err) {
      directReason = `network error: ${err instanceof Error ? err.message : String(err)}`
    }

    // ComicK passou a entregar challenge Cloudflare nos 3 bases. Quando o
    // FlareSolverr está configurado, tenta de novo via headless Chrome —
    // a resposta vem como HTML envolvendo o JSON em <pre> (comportamento
    // default do Chrome ao renderizar JSON cru).
    if (!isFlareSolverrEnabled()) {
      failures.push(`${base} direct=${directReason ?? "?"} (FlareSolverr disabled)`)
      continue
    }
    const fallback = await fetchHtmlWithCfFallback(url.toString(), HEADERS)
    if (!fallback) {
      failures.push(`${base} direct=${directReason ?? "?"} flaresolverr=no-response`)
      continue
    }
    const preMatch = fallback.html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
    const raw = (preMatch?.[1] ?? fallback.html).trim()
    try {
      return JSON.parse(raw)
    } catch {
      failures.push(`${base} direct=${directReason ?? "?"} flaresolverr=invalid-json`)
      continue
    }
  }

  console.error(
    `[comick.fetchJson] all bases failed for ${pathname}${search}: ${failures.join(" | ")}`
  )
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

const DEBUG_SEARCH = process.env.DEBUG_EXTERNAL_SEARCH === "1"

// API do ComicK tem full-text strict — queries com apóstrofo curvo (') e hífen
// frequentemente retornam 0 resultados mesmo com a obra indexada. Quando a query
// tem pontuação, dispara também uma variante stripada em paralelo e funde.
function stripPunctForQuery(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
}

async function fetchComicKSearchRows(query: string): Promise<unknown[]> {
  const url = new URL("/v1.0/search/", COMICK_BASES[0])
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "5")
  url.searchParams.set("type", "comic")
  const data = await fetchJson(url.pathname, url.search)
  return Array.isArray(data) ? data : []
}

export async function searchComicK(search: string): Promise<ExternalSearchResult[]> {
  try {
    const stripped = stripPunctForQuery(search)
    const queries = stripped && stripped.toLowerCase() !== search.toLowerCase()
      ? [search, stripped]
      : [search]

    const settled = await Promise.allSettled(queries.map((q) => fetchComicKSearchRows(q)))
    const seenHids = new Set<string>()
    const mergedRows: unknown[] = []
    let rawCount = 0
    let strippedRawCount = 0
    settled.forEach((entry, i) => {
      if (entry.status !== "fulfilled") return
      if (i === 0) rawCount = entry.value.length
      else strippedRawCount = entry.value.length
      for (const item of entry.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hid = (item as any)?.hid
        if (typeof hid !== "string" || seenHids.has(hid)) continue
        seenHids.add(hid)
        mergedRows.push(item)
      }
    })

    if (DEBUG_SEARCH && queries.length > 1) {
      console.log(
        `[searchComicK][debug] q="${search}" stripped="${stripped}" ` +
        `raw=${rawCount} stripped_raw=${strippedRawCount} merged=${mergedRows.length}`
      )
    }

    return mergedRows
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
          contentRating: typeof item?.content_rating === "string" ? item.content_rating : undefined,
        }
      })
      .filter((item): item is ExternalSearchResult => item !== null)
  } catch {
    return []
  }
}

// ============================================================================
// Reviews + comentários
// ============================================================================
// ComicK expõe duas seções de opinião na página da obra: "Reviews" (curadas, com
// nota /10) e "Comments" (discussão livre onde os usuários também compartilham
// opinião). As reviews vêm estruturadas no JSON de `/comic/{hid}` (campo
// `comic.reviews[]`); os comentários NÃO têm endpoint de API filtrável por obra
// (o `/comment/` devolve só o feed global), então são raspados do HTML SSR da
// página web da obra. Ambos entram como "review" no pipeline de avaliação.

// Domínios do frontend (não da API) usados só pra raspar comentários. comick.io
// redireciona pra comick.dev; mantemos os dois como fallback.
const COMICK_WEB_BASES = ["https://comick.io", "https://comick.dev"]

const WEB_HEADERS = {
  "User-Agent": HEADERS["User-Agent"],
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
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
    .replace(/\s+/g, " ")
    .trim()
}

/** Reviews curadas (com nota /10) do JSON de detalhe. Prefixa a nota no formato
 *  que `extractUserRating` reconhece pra o sampler de reviews aproveitar. */
async function fetchComicKReviewsFromDetail(hid: string): Promise<string[]> {
  const data = await fetchJson(`/comic/${hid}`)
  if (!data) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comic: any = (data as any)?.comic ?? data
  const reviews: unknown[] = Array.isArray(comic?.reviews) ? comic.reviews : []
  const out: string[] = []
  for (const entry of reviews) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const review: any = entry
    const content = cleanText(review?.content)
    if (!content) continue
    const ratingNum = review?.rating != null ? parseFloat(String(review.rating)) : NaN
    out.push(
      Number.isFinite(ratingNum) && ratingNum >= 0 && ratingNum <= 10
        ? `Nota do usuário: ${ratingNum}/10\n${content}`
        : content
    )
  }
  return out
}

// Comentários moram no HTML SSR da página, em <div class="comment-content ...">.
const COMMENT_CONTENT_RE = /class="comment-content[^"]*">([\s\S]*?)<\/div>/g

// O scrape bate no domínio do FRONTEND (comick.dev), que — diferente do
// api.comick.dev tocado na hidratação — costuma estar "frio" no Cloudflare. Um
// solve frio leva ~8-15s e o abort default de 5s do FlareSolverr cortava antes,
// derrubando os comentários. Damos um teto maior SÓ aqui. O clearance do
// Cloudflare persiste por IP+UA, então só a 1ª obra paga o frio; as seguintes
// entram quentes (~3s) dentro desse mesmo teto.
const COMICK_COMMENTS_CF_ABORT_MS = 16000

/** Comentários da obra raspados da página web. Filtra por tamanho mínimo (corta
 *  reação curta/emoji) e dedupa por prefixo. Best-effort: sem FlareSolverr ou com
 *  Cloudflare ativo, devolve []. */
async function fetchComicKComments(
  hid: string,
  opts: { minLength?: number; cap?: number } = {}
): Promise<string[]> {
  const minLength = opts.minLength ?? 40
  const cap = opts.cap ?? 20
  for (const base of COMICK_WEB_BASES) {
    const fallback = await fetchHtmlWithCfFallback(`${base}/comic/${hid}`, WEB_HEADERS, COMICK_COMMENTS_CF_ABORT_MS)
    if (!fallback) continue
    const comments: string[] = []
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    COMMENT_CONTENT_RE.lastIndex = 0
    while ((match = COMMENT_CONTENT_RE.exec(fallback.html)) !== null) {
      const text = stripHtmlToText(match[1])
      if (text.length < minLength) continue
      const key = text.slice(0, 80).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      comments.push(text.slice(0, 900))
      if (comments.length >= cap) break
    }
    // Página carregou (mesmo sem comentários) → não tenta o próximo domínio.
    return comments
  }
  return []
}

/**
 * Reviews + comentários da obra no ComicK, unificados como "reviews" pro pipeline
 * de avaliação. Fail-soft cada fonte — uma falha (ex.: scrape de comentários
 * bloqueado) não derruba a outra.
 *
 * As duas buscas rodam EM SÉRIE de propósito. Ambas passam pelo FlareSolverr, que
 * serializa os solves de Cloudflare; em paralelo, o JSON (abort curto) perdia a
 * disputa pelo solver, dava timeout e abria o circuit breaker — derrubando junto
 * os comentários. Em série não há contenção: o JSON bate em api.comick.dev (já
 * quente da hidratação → ~2s) e só os comentários, no frontend, pagam o solve frio.
 */
export async function fetchComicKReviews(hid: string): Promise<string[]> {
  const reviews = await fetchComicKReviewsFromDetail(hid).catch(() => [])
  const comments = await fetchComicKComments(hid).catch(() => [])
  return [...reviews, ...comments]
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
      contentRating: typeof comic.content_rating === "string" ? comic.content_rating : undefined,
    }
  } catch {
    return null
  }
}
