// ============================================================================
// Jikan — APENAS reviews do MyAnimeList
// ============================================================================
// O Jikan é um scraper NÃO-OFICIAL do MAL. Ele era a única porta de entrada da
// fonte inteira e, quando o MAL o recusa, devolve
//   504 {"message":"Jikan failed to connect to MyAnimeList..."}
// derrubando o MyAnimeList do app — mesmo com o myanimelist.net no ar (medido em
// 2026-07-12: jikan em 504, MAL em 200). A queda era do INTERMEDIÁRIO, não da fonte.
//
// Os METADADOS migraram pra API oficial (`myanimelist.ts`, header X-MAL-CLIENT-ID),
// que responde em ~250ms e não depende de scraping. Sobrou aqui só o que a API
// oficial NÃO tem: **reviews** — não existe endpoint nem campo pra elas, e é
// justamente essa lacuna que faz o Jikan existir.
//
// A saúde da fonte "myanimelist" (external_source_health) é gravada por
// `myanimelist.ts`, NÃO aqui: quem responde "dá pra obter dados do MAL?" é a API
// oficial. Dois gravadores na mesma linha ficariam se sobrescrevendo — o Jikan em
// 504 marcando `down` enquanto a API oficial, funcionando, marca `ok`.
//
// O circuito abaixo continua, mas com um propósito mais modesto: só CUSTO. Sem ele,
// cada obra pagaria 3 tentativas × 2 páginas com backoff pra sempre falhar, dentro
// de um orçamento de tempo compartilhado com as outras fontes de review.

const JIKAN_BASE = "https://api.jikan.moe/v4"

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const CIRCUIT_FAIL_THRESHOLD = 3
const CIRCUIT_TTL_MS = 5 * 60_000

let consecutiveFails = 0
let circuitOpenUntil = 0

export function isJikanCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil
}

/** Um sucesso prova que o Jikan voltou — fecha o circuito na hora. */
function recordJikanOk(): void {
  consecutiveFails = 0
  circuitOpenUntil = 0
}

function recordJikanFailure(status: number | undefined): void {
  consecutiveFails += 1
  if (consecutiveFails >= CIRCUIT_FAIL_THRESHOLD && !isJikanCircuitOpen()) {
    circuitOpenUntil = Date.now() + CIRCUIT_TTL_MS
    console.error(
      `[jikan] circuito ABERTO por ${CIRCUIT_TTL_MS / 60_000}min — ${consecutiveFails} falhas seguidas ` +
        `(último HTTP ${status ?? "?"}). Só as REVIEWS do MyAnimeList são afetadas; ` +
        `os metadados vêm da API oficial e seguem normais.`
    )
  }
}

function cleanText(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

export async function fetchJikanMangaReviews(malId: number): Promise<string[]> {
  // Jikan retorna 25 reviews por página. Pegamos páginas 1 e 2 em sequência.
  // `preliminary=true` é essencial pra manhwa em andamento — a maioria das
  // reviews fica marcada como preliminary no MAL e seria filtrada por padrão.
  // `spoiler=true` inclui reviews com spoiler (sinal valioso pra avaliação IA).
  async function fetchPage(page: number, maxAttempts = 3): Promise<unknown[]> {
    if (isJikanCircuitOpen()) return []
    const url = new URL(`${JIKAN_BASE}/manga/${malId}/reviews`)
    url.searchParams.set("page", String(page))
    url.searchParams.set("preliminary", "true")
    url.searchParams.set("spoiler", "true")
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let res: Response
      try {
        res = await fetch(url, { cache: "no-store" })
      } catch (err) {
        console.warn(`[fetchJikanMangaReviews] MAL id=${malId} page=${page} erro de rede (tentativa ${attempt}/${maxAttempts}):`, err instanceof Error ? err.message : err)
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      if (res.ok) {
        recordJikanOk()
        const json = await res.json()
        return Array.isArray(json?.data) ? json.data : []
      }
      // 404 = página inexistente (fim das reviews); silencioso, não é erro.
      if (res.status === 404) return []
      if (!TRANSIENT_STATUSES.has(res.status)) {
        console.warn(`[fetchJikanMangaReviews] MAL id=${malId} page=${page}: HTTP ${res.status} (não-retryable)`)
        return []
      }
      if (attempt < maxAttempts) {
        const delay = res.status === 429 ? 1200 * attempt : 500 * attempt
        await new Promise((r) => setTimeout(r, delay))
      } else {
        recordJikanFailure(res.status)
        console.warn(`[fetchJikanMangaReviews] MAL id=${malId} page=${page}: desistiu após ${maxAttempts} tentativas (último HTTP ${res.status})`)
      }
    }
    return []
  }

  try {
    const [page1, page2] = await Promise.all([fetchPage(1), fetchPage(2)])
    const combined = [...page1, ...page2]
    return combined
      .map((item) => {
        const record = item as Record<string, unknown>
        const review = cleanText(record.review)
        if (!review) return ""

        const score = record.score
        return typeof score === "number"
          ? `Nota do usuário: ${score}/10\n${review}`
          : review
      })
      .filter(Boolean)
      .slice(0, 50)
      .map((review) => review.slice(0, 900))
  } catch (err) {
    console.warn(`[fetchJikanMangaReviews] MAL id=${malId} falhou:`, err instanceof Error ? err.message : err)
    return []
  }
}
