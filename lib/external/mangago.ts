import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"
import { fetchHtmlWithCfFallback, isFlareSolverrCircuitOpen } from "./flaresolverr"

// ============================================================================
// Mangago (www.mangago.me) — fonte externa: metadados + rating + reviews
// ============================================================================
// Mangago NÃO tem API JSON e fica atrás de um Cloudflare *challenge*
// (headers reais: `cf-mitigated: challenge`, `server: cloudflare`). Um fetch
// direto volta 403. Por isso reusamos a mesma máquina do Comix/AnimePlanet:
// `fetchHtmlWithCfFallback` tenta o fetch direto e, ao detectar o desafio,
// roteia pelo FlareSolverr (headless Chrome). Usamos uma SESSÃO nomeada
// ("mangago") pra amortizar o solve frio (~11s na 1ª call, <1s nas seguintes)
// e um `abortMs` alto (o default de 5s cortaria o solve frio no meio).
//
// Estrutura de URL (fonte: extensão Tachiyomi/Mihon oficial do Mangago):
//   Busca:   /r/l_search/?name={query}&page={n}   → lista com links /read-manga/{slug}/
//   Detalhe: /read-manga/{slug}/                   → título, sinopse, capa, gêneros, status
//
// EXTRAÇÃO — validada ao vivo (2026-07-05, via FlareSolverr) contra Solo
// Leveling, Painter of the Night (R18) e Jujutsu Kaisen. Quirks do HTML real:
//   • Busca: os links de detalhe são URLs ABSOLUTAS (`https://.../read-manga/
//     {slug}/`, âncora `class="thm-effect"` com `title=`); os relativos são de
//     capítulo ("Latest Chapters"). O slug canônico é o 1º segmento.
//   • Gêneros: ficam após o rótulo `Genre(s):</label>` (separados por " / ").
//     A página TEM uma navegação global de gêneros (`class="track"`) que NÃO é
//     da obra — por isso escopamos ao trecho do rótulo (senão pega Yaoi/Yuri/…).
//   • Status é um ÍCONE (`manga_closed.png`=Completed / `manga_active.png`=
//     Ongoing), não texto.
//   • Sinopse de obra adulta vem prefixada com o aviso "mature audiences…
//     Discretion is advised." → removido por `stripMatureDisclaimer`.
// og:title/description/image seguem como fonte robusta / fallback. Conteúdo R18
// passou pelo FlareSolverr sem cair em interstitial (o cookie `_m_superu=1` fica
// nos headers só pro fetch direto; o helper não o repassa ao FlareSolverr).

const BASE = "https://www.mangago.me"

// Sessão FlareSolverr dedicada — reusa o MESMO Chrome quente entre calls do host.
const FS_SESSION = "mangago"
// Teto de espera da conexão com o FlareSolverr. Sobe pro mesmo patamar do Comix
// porque a 1ª call paga o solve frio de Cloudflare (~11s).
const CF_ABORT_MS = 25000

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Referer": `${BASE}/`,
  // Suprime o interstitial de conteúdo maduro no fetch direto (ver nota acima).
  "Cookie": "_m_superu=1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
}

export interface MangagoDetail {
  title: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  publicationStatus?: PublicationStatus
  genres?: string[]
  /** Nota 0-10 do widget `rating_num` (Mangago já usa escala 0-10). */
  rating?: number
  /** Nº de votos ("#### voted" ao lado do rating). */
  votes?: number
}

// ---------------------------------------------------------------------------
// HTML / texto utils (locais — espelham os do animeplanet.ts)
// ---------------------------------------------------------------------------

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
    .replace(/\s+/g, " ")
    .trim() || undefined
}

function decodeAttr(text: string | undefined): string | undefined {
  if (!text) return undefined
  return text
    // O meta description dos tópicos vem com aspas escapadas ao estilo JS
    // (\" e \&quot;). Desfaz o backslash antes de decodificar as entidades.
    .replace(/\\(&[a-zA-Z]+;|&#\d+;)/g, "$1")
    .replace(/\\(["'\\/])/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(?:039|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim() || undefined
}

// Tira sufixos de SEO que o Mangago costuma anexar no <title>/og:title.
function cleanTitle(text: string | undefined): string | undefined {
  if (!text) return undefined
  return text
    .replace(/\s*[-|–]\s*(?:read\s+)?manga(?:go)?.*$/i, "")
    .replace(/\s+manga\s*$/i, "")
    .trim() || undefined
}

// Obras adultas trazem a sinopse prefixada com o boilerplate de aviso de
// conteúdo maduro do Mangago. Remove o prefixo pra não poluir o texto avaliado.
function stripMatureDisclaimer(text: string | undefined): string | undefined {
  if (!text) return text
  return text
    .replace(/^\s*The following content is intended for mature audiences[\s\S]*?Discretion is advised\.?\s*/i, "")
    .trim() || undefined
}

function mapStatus(text: string | undefined): PublicationStatus | undefined {
  if (!text) return undefined
  const value = text.toLowerCase()
  if (value.includes("complete") || value.includes("finished")) return "Completed"
  if (value.includes("hiatus")) return "Hiatus"
  if (value.includes("cancel") || value.includes("dropped") || value.includes("discontinued")) return "Cancelled"
  if (value.includes("ongoing") || value.includes("releasing") || value.includes("publishing")) return "Ongoing"
  return undefined
}

function extractYear(text: string | undefined): number | undefined {
  const match = text?.match(/\b(19\d{2}|20\d{2})\b/)
  return match ? Number(match[1]) : undefined
}

/** Lê `content` de uma meta tag por property/name, tolerante à ordem dos atributos. */
function metaContent(html: string, key: string): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // content pode ter aspas escapadas (\") no meta description dos tópicos → captura
  // tolerante a escape (\x), senão [^"] cortaria a review na 1ª aspa embutida.
  const dq = String.raw`"((?:[^"\\]|\\.)*)"`
  const sq = String.raw`'((?:[^'\\]|\\.)*)'`
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*\\scontent=(?:${dq}|${sq})`, "i"),
    new RegExp(`<meta[^>]+content=(?:${dq}|${sq})[^>]*(?:property|name)=["']${k}["']`, "i"),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    const val = m?.[1] ?? m?.[2]
    if (val) return val
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// Texto que é referência de capítulo/volume (âncora "Latest Chapters"), não título.
function looksLikeChapterRef(text: string | undefined): boolean {
  return !!text && /^(?:ch\.?|vol\.?|chapter|volume)\b/i.test(text.trim())
}

/**
 * Extrai candidatos da página de busca. O Mangago linka cada obra por VÁRIAS
 * âncoras `/read-manga/{slug}/…`: a da capa (`class="thm-effect"`, URL ABSOLUTA
 * + `title=`) e as de "Latest Chapters" (URL relativa com caminho de capítulo).
 * O slug canônico é sempre o 1º segmento depois de `/read-manga/`. Acumula por
 * slug preferindo o `title=` da âncora de capa; ignora textos "Ch.N/Vol.N".
 */
function parseSearchResults(html: string): ExternalSearchResult[] {
  const order: string[] = []
  const bySlug = new Map<string, { titleAttr?: string; text?: string; cover?: string }>()

  // Aceita host absoluto opcional; captura o slug (1º segmento) e ignora o resto
  // do path (caminho de capítulo). Casa tanto a âncora de capa quanto as de cap.
  const anchorRegex = /<a\b([^>]*?)href="(?:https?:\/\/[^"/]+)?\/read-manga\/([^"/?#]+)[^"]*"([^>]*)>([\s\S]{0,400}?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(html)) !== null) {
    const [, pre, slug, post, inner] = match
    if (!slug) continue
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {})
      order.push(slug)
    }
    const entry = bySlug.get(slug)!
    const attrs = `${pre} ${post}`
    const titleAttr = decodeAttr(attrs.match(/\btitle="([^"]+)"/i)?.[1])
    if (titleAttr && !entry.titleAttr) entry.titleAttr = titleAttr
    const text = cleanHtml(inner)
    if (text && !looksLikeChapterRef(text) && (!entry.text || text.length > entry.text.length)) {
      entry.text = text
    }
    const imgSrc = inner.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1]
    if (imgSrc && !imgSrc.startsWith("data:") && !entry.cover) {
      try {
        entry.cover = new URL(imgSrc, BASE).toString()
      } catch {
        /* ignora src malformado */
      }
    }
  }

  const results: ExternalSearchResult[] = []
  for (const slug of order) {
    if (results.length >= 8) break
    const entry = bySlug.get(slug)!
    const title = cleanTitle(entry.titleAttr ?? entry.text)
    if (!title) continue
    results.push({
      id: `mangago:${slug}`,
      source: "mangago",
      title,
      coverUrl: entry.cover,
    })
  }
  return results
}

export async function searchMangago(query: string): Promise<ExternalSearchResult[]> {
  // CF-gated: sem FlareSolverr (circuito aberto) o fetch só volta o desafio.
  if (isFlareSolverrCircuitOpen()) return []
  try {
    const url = `${BASE}/r/l_search/?name=${encodeURIComponent(query)}&page=1`
    const result = await fetchHtmlWithCfFallback(url, HEADERS, CF_ABORT_MS, FS_SESSION)
    if (!result) return []
    return parseSearchResults(result.html)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Detail (hydrate)
// ---------------------------------------------------------------------------

/**
 * Gêneros REAIS da obra ficam logo após o rótulo `Genre(s):</label>`, como
 * âncoras `/genre/{Nome}/` separadas por " / ". CUIDADO: a página tem uma
 * navegação global de gêneros (`class="track"`, dropdown "All Genres") que NÃO
 * é da obra — por isso escopamos ao trecho depois do rótulo, até a próxima
 * célula/linha da tabela de info. Degrada pra [] se o rótulo não existir.
 */
function extractGenres(html: string): string[] {
  const labelIdx = html.search(/Genre\(s\)\s*:\s*<\/label>/i)
  if (labelIdx < 0) return []
  // Recorta do rótulo até o fim da célula/linha (evita varrer a página toda).
  const after = html.slice(labelIdx, labelIdx + 2000)
  const scope = after.split(/<\/td>|<\/tr>|<\/li>|<label\b/i)[0]
  const genres: string[] = []
  const seen = new Set<string>()
  const re = /href="[^"]*\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(scope)) !== null) {
    const genre = cleanHtml(m[1])
    if (!genre) continue
    const key = genre.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    genres.push(genre)
    if (genres.length >= 20) break
  }
  return genres
}

/**
 * Status no Mangago é um ÍCONE (não texto): `manga_closed.png` = Completed,
 * `manga_active.png`/`manga_open.png` = Ongoing. Lê o span logo após o rótulo
 * `Status:</label>`; cai pro texto se algum tema usar rótulo textual.
 */
function extractStatus(html: string): PublicationStatus | undefined {
  const labelIdx = html.search(/Status\s*:\s*<\/label>/i)
  if (labelIdx < 0) return undefined
  const scope = html.slice(labelIdx, labelIdx + 400)
  if (/manga_closed/i.test(scope)) return "Completed"
  if (/manga_active|manga_open|manga_ongoing/i.test(scope)) return "Ongoing"
  return mapStatus(cleanHtml(scope.replace(/<\/label>/i, "").replace(/<[^>]+>/g, " ")))
}

/**
 * Valor de um campo rotulado no bloco de info (ex.: "Status:", "Author:").
 * Casa o texto logo após a tag que fecha o rótulo. Best-effort → undefined.
 */
function labeledValue(html: string, label: string): string | undefined {
  const re = new RegExp(`${label}[^<:]*:?\\s*<\\/[a-z0-9]+>\\s*([^<]{1,200})`, "i")
  return cleanHtml(html.match(re)?.[1])
}

function extractAlternativeTitles(html: string): string[] {
  const raw = labeledValue(html, "alternative")
  if (!raw) return []
  return raw
    .split(/[;/｜|,]/)
    .map((title) => title.trim())
    .filter((title) => title.length > 1)
    .slice(0, 12)
}

/**
 * Rating do Mangago: `<span class="rating_num">9.8</span>` (escala 0-10, já
 * compatível com as outras fontes) + o link "#### voted" com o nº de votos.
 */
function extractRating(html: string): { rating?: number; votes?: number } {
  const ratingRaw = html.match(/class=["'][^"']*rating_num[^"']*["'][^>]*>\s*(?:&nbsp;)?\s*([\d.]+)/i)?.[1]
  const rating = ratingRaw != null ? Number(ratingRaw) : undefined
  const votesRaw = html.match(/([\d,]+)\s*voted/i)?.[1]
  const votes = votesRaw ? Number(votesRaw.replace(/,/g, "")) : undefined
  return {
    rating: rating != null && Number.isFinite(rating) && rating > 0 ? rating : undefined,
    votes: votes != null && Number.isFinite(votes) ? votes : undefined,
  }
}

export function parseMangagoDetailHtml(html: string): MangagoDetail | null {
  const rawTitle =
    metaContent(html, "og:title") ??
    html.match(/class=["'][^"']*w-title[^"']*["'][^>]*>\s*<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ??
    html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
  const title = cleanTitle(decodeAttr(rawTitle))
  if (!title) return null

  const summaryBlock = html.match(/class=["'][^"']*manga_summary[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1]
  const synopsis =
    stripMatureDisclaimer(cleanHtml(summaryBlock)) ??
    stripMatureDisclaimer(cleanHtml(decodeAttr(metaContent(html, "og:description")))) ??
    stripMatureDisclaimer(cleanHtml(decodeAttr(metaContent(html, "description"))))

  const ogImage = metaContent(html, "og:image")
  let coverUrl: string | undefined
  if (ogImage && !ogImage.startsWith("data:")) {
    try {
      coverUrl = new URL(ogImage, BASE).toString()
    } catch {
      coverUrl = undefined
    }
  }

  const genres = extractGenres(html)
  const alternativeTitles = extractAlternativeTitles(html)
  const publicationStatus = extractStatus(html)
  const year = extractYear(labeledValue(html, "(?:released|year|release date)"))
  const { rating, votes } = extractRating(html)

  // Só devolve quando há algum sinal aproveitável além do título.
  if (!synopsis && !coverUrl && genres.length === 0 && rating == null) {
    return { title }
  }

  return {
    title,
    synopsis,
    coverUrl,
    genres: genres.length > 0 ? genres : undefined,
    alternativeTitles: alternativeTitles.length > 0 ? alternativeTitles : undefined,
    publicationStatus,
    year,
    rating,
    votes,
  }
}

export async function fetchMangagoById(slug: string): Promise<MangagoDetail | null> {
  if (isFlareSolverrCircuitOpen()) return null
  try {
    const url = `${BASE}/read-manga/${slug}/`
    const result = await fetchHtmlWithCfFallback(url, HEADERS, CF_ABORT_MS, FS_SESSION)
    if (!result) return null
    return parseMangagoDetailHtml(result.html)
  } catch {
    return null
  }
}

// Descrição genérica do rodapé do site (aparece no meta de tópicos vazios) — não é opinião.
function isSiteBoilerplate(text: string): boolean {
  return /free yaoi manga|read .{0,40}manga online|all manga.*copyright/i.test(text)
}

// Páginas da lista de discussão a varrer (11 tópicos/página). Um título popular
// tem dezenas de páginas; 5 páginas dão ~55 tópicos, suficiente pro cap de 40.
const MANGAGO_REVIEW_LIST_PAGES = 5

/** Extrai (id, título) dos tópicos de uma página de discussão, na ordem exibida. */
function extractTopics(html: string, seen: Set<string>, out: Array<{ id: string; title: string }>, cap: number): number {
  const re = /\/home\/mangatopic\/(\d+)\/"[^>]*>([^<]{1,160})</gi
  let m: RegExpExecArray | null
  let added = 0
  while ((m = re.exec(html)) !== null && out.length < cap) {
    const id = m[1]
    if (seen.has(id)) continue
    const title = cleanHtml(m[2])
    if (!title) continue
    seen.add(id)
    out.push({ id, title })
    added++
  }
  return added
}

/**
 * Reviews do Mangago = posts de opinião dos usuários ("topics"), que na prática
 * funcionam como mini-reviews ("great beginning, bad ending", "the fight scenes
 * still get me hype"). Multi-hop pela sessão FlareSolverr quente:
 *   1. `/home/manga/discussion/{slug}/?page=N` → lista paginada de tópicos
 *      (id + título; 11/página). Varre até juntar `limit` ids ou acabar.
 *   2. `/home/mangatopic/{id}/` → o texto completo do 1º post vem no
 *      `<meta name="description">` (não há corpo inline confiável na página).
 * Cap em `limit` tópicos (40): é o TETO ÚTIL — o maior consumidor de reviews é o
 * "resumo" (review_summary: 40 no total, SEM cap por fonte), então buscar >40 de
 * uma fonte é desperdício (o prompt usa 12/fonte, o digest 8/fonte). 40 satura
 * todos e deixa os seletores (por comprimento) escolherem as melhores — máxima
 * qualidade que o pipeline absorve. Cada corpo é 1 fetch FlareSolverr (~1s
 * quente), então 40 ≈ ~45s; não vale ir além (só custo, zero sinal novo).
 * Fail-soft: [] em qualquer erro; para no meio se o circuito do FlareSolverr abrir.
 */
export async function fetchMangagoReviews(slug: string, limit = 40): Promise<string[]> {
  if (isFlareSolverrCircuitOpen()) return []
  try {
    // 1) Junta ids de tópico paginando a lista até ter `limit` (ou esgotar páginas).
    const topics: Array<{ id: string; title: string }> = []
    const seen = new Set<string>()
    for (let page = 1; page <= MANGAGO_REVIEW_LIST_PAGES && topics.length < limit; page++) {
      if (isFlareSolverrCircuitOpen()) break
      const url =
        page === 1
          ? `${BASE}/home/manga/discussion/${slug}/`
          : `${BASE}/home/manga/discussion/${slug}/?page=${page}&sort=date`
      const list = await fetchHtmlWithCfFallback(url, HEADERS, CF_ABORT_MS, FS_SESSION)
      if (!list) break
      const added = extractTopics(list.html, seen, topics, limit)
      if (added === 0) break // página sem tópicos novos → acabou
    }
    if (topics.length === 0) return []

    // 2) Busca o corpo de cada tópico (parte cara: 1 fetch por review).
    const reviews: string[] = []
    for (const { id, title } of topics) {
      if (isFlareSolverrCircuitOpen()) break
      const topic = await fetchHtmlWithCfFallback(`${BASE}/home/mangatopic/${id}/`, HEADERS, CF_ABORT_MS, FS_SESSION)
      if (!topic) continue
      const body = cleanHtml(decodeAttr(metaContent(topic.html, "description")))
      // Corpo do post é a opinião plena; cai pro título quando o tópico não tem corpo.
      const text = body && !isSiteBoilerplate(body) ? body : title
      if (!text || text.length < 8) continue
      if (/^\s*https?:\/\/\S+\s*$/i.test(text)) continue // link solto, não é opinião
      reviews.push(text.length > 900 ? `${text.slice(0, 900)}…` : text)
    }
    return reviews
  } catch {
    return []
  }
}
