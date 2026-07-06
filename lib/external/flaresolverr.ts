// FlareSolverr is a self-hosted Docker container that runs headless Chrome to
// solve Cloudflare challenges and returns the post-challenge HTML + cookies.
// Setup:
//   docker run -d --name flaresolverr -p 8191:8191 \
//     -e LOG_LEVEL=info ghcr.io/flaresolverr/flaresolverr:latest
//   Add to .env.local: FLARESOLVERR_URL=http://localhost:8191/v1
//
// When the env var is unset, helpers fall back to a plain fetch (no CF bypass).

const ENDPOINT = process.env.FLARESOLVERR_URL?.trim() || ""

// Timeout de conexão curto: a porta às vezes aceita a conexão mas não responde
// (container fora), e o fetch ficaria pendurado até o teto externo (8s). Menor
// que o withTimeout do orquestrador pra o catch disparar e abrir o circuito.
const FLARESOLVERR_TIMEOUT_MS = 5000
// Circuit breaker: ao falhar, marca indisponível por um tempo pra não pagar o
// timeout em CADA chamada (enriquecimento em lote chama comix dezenas de vezes).
// Reabre sozinho depois do TTL (se o container voltar, volta a usar).
const CIRCUIT_TTL_MS = 60_000
// O circuito só abre num ERRO DE CONEXÃO (container caído → ECONNREFUSED, que é
// imediato). Um TIMEOUT do nosso abort NÃO abre: quase sempre é só um solve de
// Cloudflare em andamento (container vivo, porém lento) e, num fluxo com várias
// fontes de scraping em paralelo (+ re-consultas por título alternativo),
// timeouts legítimos são comuns — abrir 60s por causa de um solve lento
// bloqueava rating+reviews do mangago/comix na MESMA avaliação. Só o caso raro
// de container "pendurado" (aceita conexão e nunca responde) fica sem o atalho;
// cada call ali paga o próprio abortMs (limitado + raro).
let circuitOpenUntil = 0

/** True when FlareSolverr is configured (env var present). */
export function isFlareSolverrEnabled(): boolean {
  return ENDPOINT.length > 0
}

/** Circuito aberto = FlareSolverr falhou recentemente; chamadas devem pular pra
 *  não pagar o timeout repetidamente (reabre sozinho após o TTL). */
export function isFlareSolverrCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil
}

/** Heuristic: is this response HTML a Cloudflare challenge page? */
export function isCloudflareChallenge(html: string): boolean {
  return /cf-mitigated|challenge-platform|Just a moment|cf-chl-bypass/i.test(html)
}

/**
 * Ping leve no FlareSolverr (`sessions.list`) — só confirma que o container está de
 * pé e responde, sem pagar nenhum solve. Usado pelo diagnóstico da Comix.
 */
export async function flareSolverrHealth(): Promise<{
  ok: boolean
  version?: string
  sessions?: string[]
  error?: string
}> {
  if (!ENDPOINT) return { ok: false, error: "FLARESOLVERR_URL não configurada" }
  try {
    const res = await postFlareSolverr({ cmd: "sessions.list" }, FLARESOLVERR_TIMEOUT_MS)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const json = await res.json()
    return {
      ok: json?.status === "ok",
      version: typeof json?.version === "string" ? json.version : undefined,
      sessions: Array.isArray(json?.sessions) ? json.sessions : undefined,
      error: json?.status === "ok" ? undefined : String(json?.message ?? "resposta inesperada"),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Fetch HTML through FlareSolverr. Returns the post-challenge HTML + final URL
 * on success (FlareSolverr follows redirects, so finalUrl may differ from the
 * requested url — useful when AP collapses single-result search → detail page).
 */
// Loga uma única vez por processo pra evitar spam quando o container está fora
// do ar — todos os calls subsequentes vão logar a mesma coisa.
let flareSolverrFailureLogged = false

function logFlareSolverrFailure(reason: string) {
  if (flareSolverrFailureLogged) return
  console.error(`[flareSolverr] ${ENDPOINT}: ${reason}`)
  flareSolverrFailureLogged = true
}

/** POST cru ao endpoint do FlareSolverr (request.get / sessions.*). */
function postFlareSolverr(body: Record<string, unknown>, abortMs: number): Promise<Response> {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(abortMs),
  })
}

/** Cria (best-effort) uma sessão nomeada. Tolerante a "already exists": o que
 *  importa é a sessão existir pro request.get seguinte; se não vingar, o retry
 *  falha e o circuito abre. */
async function flareSolverrCreateSession(session: string, abortMs: number): Promise<void> {
  try {
    await postFlareSolverr({ cmd: "sessions.create", session }, abortMs)
  } catch {
    /* ignore — o retry do request.get decide o destino */
  }
}

export async function flareSolverrFetch(
  url: string,
  timeoutMs = 60000,
  // Teto de espera da NOSSA conexão com o FlareSolverr. Default curto (5s) detecta
  // container caído rápido; chamadas que sabem que vão pagar um solve frio de
  // Cloudflare (ex.: scrape de página) passam um valor maior pra não cortar antes
  // do desafio terminar. Não confundir com `timeoutMs` (orçamento do Chrome
  // headless DENTRO do FlareSolverr).
  abortMs = FLARESOLVERR_TIMEOUT_MS,
  // Sessão nomeada: reusa o MESMO Chrome (com o cf_clearance vivo DENTRO do browser)
  // entre chamadas. Essencial p/ hosts onde TODA request é desafiada (comix pós-2026-06):
  // a 1ª call paga o solve frio (~11s), as seguintes na mesma sessão saem em <1s. O
  // clearance não é replayável por fetch externo (a CF o amarra ao fingerprint do
  // browser), então a sessão é o único jeito de amortizar o solve.
  session?: string
): Promise<{ html: string; finalUrl: string } | null> {
  if (!ENDPOINT) return null
  // Circuito aberto (container falhou recentemente) → falha na hora, sem esperar.
  if (Date.now() < circuitOpenUntil) return null
  try {
    const body: Record<string, unknown> = { cmd: "request.get", url, maxTimeout: timeoutMs }
    if (session) body.session = session

    let res = await postFlareSolverr(body, abortMs)
    if (!res.ok) {
      logFlareSolverrFailure(`HTTP ${res.status} — container caído ou misconfigurado?`)
      circuitOpenUntil = Date.now() + CIRCUIT_TTL_MS
      return null
    }
    let json = await res.json()

    // Sessão ainda não existe nesse FlareSolverr (1º uso ou o container reiniciou e
    // perdeu as sessões): cria e tenta de novo UMA vez. Sem `session`, não roda.
    if (session && json?.status === "error" && /session/i.test(String(json?.message ?? ""))) {
      await flareSolverrCreateSession(session, abortMs)
      res = await postFlareSolverr(body, abortMs)
      if (!res.ok) {
        logFlareSolverrFailure(`HTTP ${res.status} — após criar sessão`)
        circuitOpenUntil = Date.now() + CIRCUIT_TTL_MS
        return null
      }
      json = await res.json()
    }

    const html = json?.solution?.response
    const finalUrl = typeof json?.solution?.url === "string" ? json.solution.url : url
    if (typeof html !== "string" || html.length === 0) {
      logFlareSolverrFailure(`resposta sem solution.response (status=${json?.status ?? "?"} message="${json?.message ?? ""}")`)
      return null
    }
    circuitOpenUntil = 0 // sucesso → fecha o circuito
    return { html, finalUrl }
  } catch (err) {
    // Timeout do NOSSO abort (AbortSignal.timeout) = container vivo mas lento
    // (solve de CF em andamento), não caído → NÃO abre o circuito, só este call
    // falha; as outras fontes/sessões seguem tentando.
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || /aborted due to timeout/i.test(err.message))
    if (isTimeout) return null
    // Erro de conexão (ECONNREFUSED etc.) = container caído → abre o circuito na hora.
    logFlareSolverrFailure(`falha de rede (${err instanceof Error ? err.message : err}) — container provavelmente não está rodando`)
    circuitOpenUntil = Date.now() + CIRCUIT_TTL_MS
    return null
  }
}

/**
 * Fetch HTML with automatic Cloudflare fallback: try direct fetch first; if the
 * response looks like a CF challenge and FlareSolverr is configured, retry through it.
 */
/**
 * Returns post-CF-bypass HTML AND the final URL (after redirects). The url is
 * needed when an AP-style "search?name=X" collapses to a detail page for a
 * single-result query, leaving the caller without a way to know the slug.
 */
export async function fetchHtmlWithCfFallback(
  url: string,
  headers: Record<string, string> = {},
  // Repassado ao FlareSolverr como teto de espera da conexão. Default 5s; suba pra
  // páginas que pagam solve frio de Cloudflare (ver flareSolverrFetch).
  abortMs?: number,
  // Sessão nomeada do FlareSolverr p/ amortizar o solve entre calls do mesmo host
  // (ver flareSolverrFetch). Só vale o fallback; o plain fetch direto não usa sessão.
  session?: string
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { headers, cache: "no-store" })
    if (res.ok) {
      const html = await res.text()
      if (!isCloudflareChallenge(html)) {
        return { html, finalUrl: res.url || url }
      }
    }
  } catch {
    // fall through to FlareSolverr
  }
  if (!ENDPOINT) return null
  return flareSolverrFetch(url, 60000, abortMs, session)
}
