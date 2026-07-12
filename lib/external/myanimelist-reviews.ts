// ============================================================================
// MyAnimeList — reviews (scraping direto do site)
// ============================================================================
// A API oficial v2 (`myanimelist.ts`) NÃO tem reviews: não existe endpoint nem campo.
// É exatamente essa lacuna que fez o Jikan existir — e o Jikan, sendo um scraper
// não-oficial, ficava em 504 quando o MAL o recusava, zerando as reviews do MAL no app.
//
// Aqui o intermediário morre: buscamos a página de reviews do próprio myanimelist.net,
// que responde 200 sem Cloudflare (medido em 2026-07-12) e é permitida pelo robots.txt
// (o `Disallow` cobre /admin/, /log/, /comments.php e afins — não /manga/*/reviews).
//
// COBERTURA (amostra de 20 obras do catálogo, 2026-07-12): 80% têm ao menos 1 review,
// média de 7,2 por obra. Não é um detalhe — é uma fonte inteira que estava zerada.

const MAL_BASE = "https://myanimelist.net"

// ⚠️ O segmento do slug é OBRIGATÓRIO, mesmo sendo ignorado pelo MAL.
//
// `/manga/{id}/{qualquer_coisa}/reviews` → a página de reviews (20 por página).
// `/manga/{id}/reviews`                  → o MAL trata "reviews" COMO SE FOSSE O SLUG e
//                                          serve a página de DETALHE, que traz só ~3
//                                          reviews de amostra. HTTP 200, HTML válido,
//                                          dado errado — falha silenciosa clássica.
//
// Como o slug é ignorado, não precisamos derivá-lo do título: um placeholder basta.
const SLUG_PLACEHOLDER = "_"

// `preliminary=on` é essencial pra obra EM ANDAMENTO: no MAL a maioria das reviews de
// manhwa em curso fica marcada como preliminar e seria filtrada por padrão (medido: uma
// obra do catálogo saltou de 0 para 1 review só com esse filtro). `spoiler=on` inclui
// reviews com spoiler — sinal valioso pra avaliação de IA, que não "estraga" nada.
const FILTERS = "preliminary=on&spoiler=on"

const PAGES = 2 // 20 reviews por página; 2 páginas cobrem o cap de 50 com folga.
const MAX_REVIEWS = 50
const MAX_CHARS = 900
const TIMEOUT_MS = 12_000
const POLITE_DELAY_MS = 400

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
}

export interface MalReview {
  text: string
  score?: number
}

/**
 * Extrai as reviews de UMA página. Exportado pra ser testado contra um recorte real do
 * HTML do MAL (tests/fixtures/myanimelist/), sem rede.
 *
 * Cada review é um `div.review-element`, com:
 *   - a nota num bloco escondido: `Rating: <span class="num">7</span>` — o `js-hidden` é
 *     só CSS, o valor está no HTML;
 *   - o corpo em `div.text`.
 */
export function parseMalReviewsHtml(html: string): MalReview[] {
  const blocks = html.split(/<div class="review-element js-review-element"/).slice(1)

  return blocks
    .map((block): MalReview | null => {
      const body = block.match(/<div class="text">([\s\S]*?)<\/div>/)?.[1]
      const text = body ? stripTags(body) : ""
      if (!text) return null

      const raw = block.match(/Rating:\s*<span[^>]*class="num"[^>]*>\s*([\d.]+)/i)?.[1]
      const score = raw != null ? Number(raw) : NaN

      return Number.isFinite(score) ? { text, score } : { text }
    })
    .filter((r): r is MalReview => r !== null)
}

async function fetchPage(malId: number, page: number): Promise<string | null> {
  const url =
    `${MAL_BASE}/manga/${malId}/${SLUG_PLACEHOLDER}/reviews?${FILTERS}` +
    (page > 1 ? `&p=${page}` : "")
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
    // 404 = a página não existe, ou seja, as reviews acabaram. É o caso NORMAL de toda
    // obra com menos de 20 reviews — que é a maioria do catálogo. Logar isso como falha
    // encheria o log de ruído e faria o comportamento esperado parecer problema.
    if (res.status === 404) return null
    if (!res.ok) {
      console.warn(`[mal-reviews] id=${malId} page=${page}: HTTP ${res.status}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.warn(`[mal-reviews] id=${malId} page=${page} falhou:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Reviews de uma obra no MyAnimeList, no mesmo contrato que o resto do app espera:
 * strings prontas pro prompt, com a nota do usuário como cabeçalho quando existir.
 */
export async function fetchMalReviews(malId: number): Promise<string[]> {
  const out: MalReview[] = []

  // Páginas em SEQUÊNCIA (não em paralelo): duas requisições simultâneas ao mesmo host
  // por obra, num backfill de centenas de obras, é o tipo de coisa que faz um site
  // legítimo te bloquear. O custo é ~400ms por obra — barato pelo que evita.
  for (let page = 1; page <= PAGES; page += 1) {
    const html = await fetchPage(malId, page)
    if (!html) break

    const reviews = parseMalReviewsHtml(html)
    if (reviews.length === 0) break // página vazia = acabaram as reviews

    out.push(...reviews)
    if (out.length >= MAX_REVIEWS) break
    if (page < PAGES) await sleep(POLITE_DELAY_MS)
  }

  return out
    .slice(0, MAX_REVIEWS)
    .map(({ text, score }) =>
      score != null ? `Nota do usuário: ${score}/10\n${text}` : text
    )
    .map((review) => review.slice(0, MAX_CHARS))
}
