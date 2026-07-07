import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isCloudflareChallenge, isFlareSolverrEnabled, isFlareSolverrCircuitOpen } from "./flaresolverr"
import { recordComixOk, recordComixFailure } from "./comix-gate"
import type { ComixFailure } from "./comix-gate"

const COMIX_BASE = "https://comix.to/api/v1"

// Teto de espera da NOSSA conexão com o FlareSolverr nas chamadas do comix. O
// default (5s) é curto pra um solve FRIO de Cloudflare: o comix passou a desafiar
// até a navegação SSR (/title/{hid}), e o solve medido leva ~11s. Aborto em 5s
// cortava antes do desafio terminar → null + circuit aberto, fazendo a atribuição
// manual de hid e o fetch de detalhe/reviews falharem mesmo com o hid certo.
// 25s dá folga sobre a variância do solve (maxTimeout interno do Chrome é 60s).
const COMIX_CF_ABORT_MS = 25000

// Sessão FlareSolverr compartilhada por TODAS as chamadas do comix. Desde ~2026-06-12
// (fim do dia) a CF do comix ficou estrita: SSR (/title/{hid}) E os endpoints
// /api/v1/* (incl. /threads/*) passaram a ser desafiados, e o cf_clearance NÃO é
// replayável por fetch externo. Sem sessão, cada uma das ~4 calls de uma review pagaria
// um solve frio (~11s → ~44s, estourando o teto). Com a sessão, só a 1ª paga o solve;
// as seguintes reusam o browser quente (<1s). A sessão é lazy (criada no 1º uso) e
// persistente (sobrevive entre requests até o container reiniciar — flareSolverrFetch
// recria sob demanda).
const COMIX_FS_SESSION = "comix"

// The comix.to API only responds with full data when called as an XHR
// (same origin pattern). Without X-Requested-With the detail endpoint returns 404.
const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://comix.to/",
}

// Navegação de página (HTML SSR), não-XHR. A página /title/{hid} responde ao
// plain fetch com um <script> de hidratação que já contém o objeto completo da obra.
const HTML_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent": HEADERS["User-Agent"],
  Referer: "https://comix.to/",
}

// Choke point ÚNICO de falhas do Comix: além de logar, reporta ao ComixGate
// (fonte única de saúde observada). Toda superfície de falha passa por aqui.
function logComixFailure(url: string, reason: ComixFailure, detail?: string) {
  console.error(`[comix] ${reason} url=${url}${detail ? ` detail=${detail}` : ""}`)
  recordComixFailure(reason)
}

// Circuit breaker de auth: desde ~2026-06 a API /api/v1/manga* do comix.to exige um
// token de assinatura `_=` gerado no client (anti-bot, chunk VM-ofuscado) e responde
// {"message":"Missing token."} sem ele. Isso afeta SÓ a busca (`/manga?keyword=`) e o
// detalhe-via-API (`/manga/{hid}`). O detalhe e as reviews foram migrados pro caminho
// TOKEN-FREE (SSR de /title/{hid} → objeto da obra + id interno; endpoints /threads/*
// não exigem token), então o circuito hoje cobre APENAS a busca: ao detectar
// "Missing token." abre o circuito e devolve [] na busca até o TTL reabrir (caso a API
// volte a ser pública), sem pagar solves de CF à toa.
const COMIX_AUTH_CIRCUIT_TTL_MS = 30 * 60_000
let comixAuthCircuitOpenUntil = 0
let comixAuthLogged = false

/** Resposta do origin indicando que a API exige token de auth (gateada). */
function isComixAuthError(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  const msg = (data as { message?: unknown }).message
  return typeof msg === "string" && /missing token/i.test(msg)
}

/**
 * Mesmo check, mas a partir do corpo bruto (string) de uma resposta não-ok.
 * O 403 atual do comix já entrega `{"message":"Missing token."}` em JSON no
 * fetch direto — detectar aqui evita pagar um solve de Cloudflare (~8-15s) só
 * pra receber o mesmo erro. Exige que o corpo realmente parseie como JSON com
 * `message` contendo "missing token" (não confia só no regex pra não dar falso
 * positivo com conteúdo legítimo).
 */
function bodyHasComixAuthError(body: string): boolean {
  if (!/missing token/i.test(body)) return false
  try {
    return isComixAuthError(JSON.parse(body))
  } catch {
    return false
  }
}

/** Abre o circuito de auth do Comix e loga uma única vez por processo. */
function tripComixAuthCircuit(url: string): void {
  comixAuthCircuitOpenUntil = Date.now() + COMIX_AUTH_CIRCUIT_TTL_MS
  if (comixAuthLogged) return
  logComixFailure(url, "api_auth_required", "API exige token (login) — pulando Comix até o TTL reabrir")
  comixAuthLogged = true
}

// comix.to fica atrás do Cloudflare Challenge — fetch direto retorna 403/HTML.
// Mesmo padrão de comick.ts: tenta fetch normal, e se falhar com challenge,
// faz fallback via FlareSolverr (headless Chrome) extraindo JSON do <pre>.
async function fetchComixJson(path: string): Promise<unknown | null> {
  const url = `${COMIX_BASE}${path}`

  // Circuito de auth aberto: a API exigiu token recentemente — pula tudo, inclusive
  // o solve de Cloudflare (que voltaria só "Missing token."). Comix fica indisponível
  // até o TTL reabrir.
  if (Date.now() < comixAuthCircuitOpenUntil) return null

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
          const data = await res.json()
          // API gateada (login) → abre o circuito e desiste do Comix.
          if (isComixAuthError(data)) {
            tripComixAuthCircuit(url)
            return null
          }
          recordComixOk()
          return data
        } catch (err) {
          logComixFailure(url, "json_parse_error", err instanceof Error ? err.message : String(err))
        }
      } else {
        const body = await res.text()
        directBodyLooksLikeChallenge = isCloudflareChallenge(body)
      }
    } else {
      const body = await res.text().catch(() => "")
      // API gateada (login): o 403 já traz "Missing token." em JSON no corpo
      // direto → abre o circuito aqui e desiste, SEM cair no fallback de
      // Cloudflare (que só devolveria o mesmo erro pagando o solve).
      if (bodyHasComixAuthError(body)) {
        tripComixAuthCircuit(url)
        return null
      }
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

  const fallback = await fetchHtmlWithCfFallback(url, HEADERS, COMIX_CF_ABORT_MS, COMIX_FS_SESSION)
  if (!fallback) {
    logComixFailure(url, "cloudflare_challenge", "flaresolverr returned no response")
    return null
  }
  const preMatch = fallback.html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  const raw = (preMatch?.[1] ?? fallback.html).trim()
  try {
    const data = JSON.parse(raw)
    // API gateada (login): atravessou o CF mas o origin pediu token → abre o
    // circuito pra não pagar mais solves só pra receber "Missing token.".
    if (isComixAuthError(data)) {
      tripComixAuthCircuit(url)
      return null
    }
    recordComixOk()
    return data
  } catch (err) {
    logComixFailure(url, "json_parse_error", `after-flaresolverr: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Busca o HTML SSR de uma página do comix (TOKEN-FREE). `/title/{hid}` responde ao
 * plain fetch com um <script> de hidratação contendo o objeto completo da obra (incl.
 * o `id` interno usado pelos threads). Cai pro FlareSolverr só se o Cloudflare desafiar.
 */
async function fetchComixHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HTML_HEADERS, cache: "no-store" })
    const body = await res.text()
    if (res.ok) {
      if (!isCloudflareChallenge(body)) {
        recordComixOk()
        return body
      }
    } else if (!isCloudflareChallenge(body)) {
      // Erro real (404 etc.) que não é challenge — FlareSolverr não ajudaria.
      logComixFailure(url, "http_error", `status=${res.status}`)
      return null
    }
  } catch (err) {
    logComixFailure(url, "network_error", err instanceof Error ? err.message : String(err))
  }

  if (!isFlareSolverrEnabled() || isFlareSolverrCircuitOpen()) return null
  const fallback = await fetchHtmlWithCfFallback(url, HTML_HEADERS, COMIX_CF_ABORT_MS, COMIX_FS_SESSION)
  if (!fallback) {
    logComixFailure(url, "cloudflare_challenge", "flaresolverr returned no response")
    return null
  }
  recordComixOk()
  return fallback.html
}

/**
 * GET de um endpoint /api/v1 TOKEN-FREE (threads de comentário de nível-obra). Esses
 * endpoints não exigem o token de assinatura `_=` (só /manga* exige), então resolvem
 * por plain fetch; FlareSolverr só como fallback de CF. NÃO consulta o circuito de
 * auth (que cobre apenas a busca gateada).
 */
async function fetchComixThreadJson(path: string): Promise<unknown | null> {
  const url = `${COMIX_BASE}${path}`
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" })
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
      try {
        const json = await res.json()
        recordComixOk()
        return json
      } catch (err) {
        logComixFailure(url, "json_parse_error", err instanceof Error ? err.message : String(err))
      }
    }
  } catch (err) {
    logComixFailure(url, "network_error", err instanceof Error ? err.message : String(err))
  }

  if (!isFlareSolverrEnabled() || isFlareSolverrCircuitOpen()) return null
  const fallback = await fetchHtmlWithCfFallback(url, HEADERS, COMIX_CF_ABORT_MS, COMIX_FS_SESSION)
  if (!fallback) return null
  const preMatch = fallback.html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  const raw = (preMatch?.[1] ?? fallback.html).trim()
  try {
    const json = JSON.parse(raw)
    recordComixOk()
    return json
  } catch (err) {
    logComixFailure(url, "json_parse_error", `after-flaresolverr: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Extrai o objeto completo da obra do <script> de hidratação SSR da página
 * /title/{hid} (React Query cache key ["manga","detail",hid]). Substitui o endpoint
 * /manga/{hid}, que passou a exigir token de assinatura. Mesmo shape do antigo
 * `result` (id/hid/title/synopsis/ratedAvg/links/genres/…).
 *
 * IMPORTANTE: casa pelo `hid` PEDIDO. A página às vezes prefetcha o detalhe de OUTRAS
 * obras (carrosséis de recomendação/trending) no mesmo cache de hidratação; pegar o
 * "primeiro manga-detail" retornava a obra ERRADA (detalhe e reviews). Só faz fallback
 * pro único candidato quando a página traz exatamente um (sem ambiguidade).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractComixDetailFromHtml(html: string, hid: string): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates: { keyHid: unknown; value: any }[] = []
  const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of scripts) {
    const inner = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim()
    if (!inner.startsWith("{") || !inner.includes('"queries"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(inner)
    } catch {
      continue
    }
    const queries = (parsed as { queries?: unknown }).queries
    if (!queries || typeof queries !== "object") continue
    for (const [key, value] of Object.entries(queries as Record<string, unknown>)) {
      let arr: unknown
      try {
        arr = JSON.parse(key)
      } catch {
        continue
      }
      if (
        Array.isArray(arr) &&
        arr[0] === "manga" &&
        arr[1] === "detail" &&
        value &&
        typeof value === "object" &&
        (value as { hid?: unknown }).hid
      ) {
        candidates.push({ keyHid: arr[2], value })
      }
    }
  }
  // Match exato pelo hid pedido (no payload ou na chave do cache).
  const exact = candidates.find((c) => c.value.hid === hid || c.keyHid === hid)
  if (exact) return exact.value
  // Sem match exato mas a página traz só um detalhe → é o da obra pedida.
  if (candidates.length === 1) return candidates[0].value
  return null
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

export function linksFromItem(links: unknown): ComixDetail["links"] {
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
  // Token-free: o objeto completo da obra vem no <script> de hidratação SSR da página
  // /title/{hid}. O antigo endpoint /manga/{hid} passou a exigir token de assinatura.
  const html = await fetchComixHtml(comixWorkUrl(hid))
  if (!html) return null
  const r = extractComixDetailFromHtml(html, hid)
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
 * Cadeia (TOKEN-FREE — desde que /manga* foi gateado atrás do token `_=`):
 *  1. SSR de /title/{hid} → id interno numérico (page_identifier = "manga{id}").
 *     O id numérico é obrigatório: usar o hid literal ("manga{hid}") resolve thread
 *     errada. Vem do <script> de hidratação via `extractComixDetailFromHtml`.
 *  2. GET /threads/lookup?page_identifier=…&page_url=/title/{hid} → threadId
 *     (ambos os params são obrigatórios; o feed global /comments NÃO filtra por obra)
 *  3. GET /threads/{threadId}/comments (paginado por cursor) → items[].contentHtml
 * Threads via `fetchComixThreadJson` (plain fetch token-free, FlareSolverr só fallback CF).
 */
/**
 * Achata os textos de uma lista de comentários do Comix + suas RESPOSTAS, que
 * vêm ANINHADAS inline no mesmo payload (`item.replies[]`, recursivo — sem fetch
 * extra). Muitas vezes o comentário de topo é fraco mas uma resposta traz o
 * insight. Aplica os mesmos filtros (visível, não banido) e trunca em 900 chars.
 * Limita profundidade e total pra não estourar em threads virais (respostas
 * profundas ficam de fora do payload de qualquer forma — vêm por cursor próprio).
 */
function collectComixCommentTexts(
  items: unknown[],
  out: string[],
  opts: { maxDepth: number; cap: number },
  depth = 0,
): void {
  for (const item of items) {
    if (out.length >= opts.cap) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const it = item as any
    if (it?.isBanned || it?.isShadowBanned) continue
    if (typeof it?.status === "string" && it.status !== "visible") continue
    if (typeof it?.contentHtml === "string") {
      // Trunca em 900 chars como as outras fontes pra não inflar tokens.
      const text = stripHtmlToText(it.contentHtml).slice(0, 900)
      if (text) out.push(text)
    }
    if (depth < opts.maxDepth && Array.isArray(it?.replies) && it.replies.length > 0) {
      collectComixCommentTexts(it.replies, out, opts, depth + 1)
    }
  }
}

export async function fetchComixReviews(hid: string): Promise<string[]> {
  // Token-free: o id interno vem do SSR da página; os endpoints /threads/* não exigem
  // o token de assinatura `_=` (só /manga* exige).
  const html = await fetchComixHtml(comixWorkUrl(hid))
  if (!html) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internalId = (extractComixDetailFromHtml(html, hid) as any)?.id
  if (typeof internalId !== "number") return []

  const lookupPath = `/threads/lookup?page_identifier=manga${internalId}&page_url=${encodeURIComponent(`/title/${hid}`)}`
  const lookup = await fetchComixThreadJson(lookupPath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadId = (lookup as any)?.result?.thread?.id
  if (typeof threadId !== "number" || threadId <= 0) return []

  const texts: string[] = []
  const CAP = 60 // topo + respostas aninhadas; o seletor a jusante corta por fonte
  let cursor: string | undefined
  // 2 páginas (~44 comentários de topo) + as respostas aninhadas de cada um.
  for (let page = 0; page < 2; page++) {
    const path = `/threads/${threadId}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    const data = await fetchComixThreadJson(path)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (data as any)?.result
    const items: unknown[] = Array.isArray(result?.items) ? result.items : []
    collectComixCommentTexts(items, texts, { maxDepth: 3, cap: CAP })
    cursor = typeof result?.cursor === "string" && result.cursor ? result.cursor : undefined
    if (!cursor || items.length === 0 || texts.length >= CAP) break
  }
  return texts
}
