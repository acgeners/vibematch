// FlareSolverr is a self-hosted Docker container that runs headless Chrome to
// solve Cloudflare challenges and returns the post-challenge HTML + cookies.
// Setup:
//   docker run -d --name flaresolverr -p 8191:8191 \
//     -e LOG_LEVEL=info ghcr.io/flaresolverr/flaresolverr:latest
//   Add to .env.local: FLARESOLVERR_URL=http://localhost:8191/v1
//
// When the env var is unset, helpers fall back to a plain fetch (no CF bypass).

import { isComixRenderConfigured, renderHtmlViaSidecar } from "./comix-render-client"

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

/**
 * Não há NENHUMA camada de bypass de Cloudflare disponível agora — só então vale
 * a pena uma fonte CF-gated desistir antes de tentar.
 *
 * ⚠️ É isto que as fontes devem checar, NÃO `isFlareSolverrCircuitOpen()` sozinho.
 * O circuito do FlareSolverr é global e abre em ECONNREFUSED (container fora) — que
 * hoje é o estado NORMAL de dev, já que o sidecar é a camada primária e o Docker é
 * opcional (ver CLAUDE.md). Com `FLARESOLVERR_URL` setado e o container parado, basta
 * UM render cair no FlareSolverr (sidecar ocupado/erro) pra abrir o circuito por 60s
 * — e quem checava só o circuito devolvia `[]` sem nem tentar o sidecar, que estava
 * saudável. Resultado: Mangago e AnimePlanet sumiam da busca por um minuto, em
 * silêncio, por causa da saúde de um fallback que nem seria usado.
 *
 * Com o sidecar configurado nunca pulamos: se ELE também estiver fora, o próprio
 * circuito interno dele (`renderHtmlViaSidecar`) devolve null na hora, e o
 * FlareSolverr é pulado pelo circuito dele — o atalho continua barato.
 */
export function isCfBypassUnavailable(): boolean {
  return !isComixRenderConfigured() && isFlareSolverrCircuitOpen()
}

/**
 * O HTML é uma página de DESAFIO do Cloudflare (bloqueio), ou só uma página
 * protegida por ele?
 *
 * NÃO casar com `challenge-platform` solto: o Cloudflare injeta o script de
 * bot-management PASSIVO (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) em
 * páginas servidas NORMALMENTE — com conteúdo, status 200 e sem mitigação. Casar
 * com ele classificava HTML bom como desafio, então TODA chamada do comix
 * descartava a resposta que já tinha em mãos (~350ms) e ia pro FlareSolverr;
 * com o container fora, detalhe e reviews do comix simplesmente sumiam.
 *
 * O bloqueio de verdade é inequívoco (medido em anime-planet/mangago/comick):
 * 403 + header `cf-mitigated: challenge`, e o interstitial traz "Just a moment",
 * `_cf_chl_opt` e o script de `orchestrate` (≠ do `jsd` passivo).
 * Fixtures reais dos dois lados: tests/fixtures/cloudflare/.
 */
export function isCloudflareChallenge(html: string): boolean {
  return /cf-mitigated|Just a moment|cf-chl-bypass|_cf_chl_opt|challenge-platform\/h\/[a-z]+\/orchestrate/i.test(html)
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

// Uma sessão nomeada do FlareSolverr é UM Chrome — uma aba só. Duas chamadas
// concorrentes na MESMA sessão navegam essa mesma aba, e uma acaba lendo a página
// da outra. MEDIDO: duas buscas paralelas no mangago ("The Majesty Makeover" e
// "Growing the Seed of Evil") devolveram AMBAS o mesmo resultado — em série, cada
// uma trazia a obra certa. Na prática isso vinculava a obra errada à fonte.
//
// Serializa por sessão: a vantagem da sessão nomeada (não repagar o solve frio do
// Cloudflare, ~11s) só é válida com uso exclusivo. Troca corrupção silenciosa por
// fila. Chamadas SEM sessão não entram na fila — o FlareSolverr cria uma sessão
// efêmera por request, que já é isolada.
//
// (O sidecar `comix-render` usa um BrowserContext por request e é imune por
// construção — quando ele substituir o FS de vez, esta fila sai junto.)
const sessionLocks = new Map<string, Promise<unknown>>()

function withSessionLock<T>(session: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!session) return run()
  const prev = sessionLocks.get(session) ?? Promise.resolve()
  // `then(run, run)` — uma falha da chamada anterior não pode envenenar a fila.
  const next = prev.then(run, run)
  sessionLocks.set(
    session,
    next.catch(() => {}),
  )
  return next
}

export function flareSolverrFetch(
  url: string,
  timeoutMs = 60000,
  abortMs = FLARESOLVERR_TIMEOUT_MS,
  session?: string,
): Promise<{ html: string; finalUrl: string } | null> {
  return withSessionLock(session, () => flareSolverrFetchExclusive(url, timeoutMs, abortMs, session))
}

/** Corpo real. Só roda com a sessão travada (ver `withSessionLock`). */
async function flareSolverrFetchExclusive(
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
    // cai pro bypass
  }

  // Bypass em 2 camadas, nesta ordem:
  //
  // 1) SIDECAR (browser real, Playwright). Preferido: medido passando o Cloudflare de
  //    anime-planet, mangago, comick e comix — as mesmas URLs que dão 403 `cf-mitigated`
  //    ao fetch do Node (o bloqueio é por fingerprint TLS/browser, não por conteúdo).
  //    É o mesmo processo que já resolve o hid do Comix; não há infra nova.
  // 2) FLARESOLVERR (legado). Rede de segurança enquanto o sidecar não está deployado em
  //    todo lugar — e para o caso de um desafio que o Playwright puro não vença. Some
  //    quando o sidecar provar o valor em produção.
  //
  // Sem `COMIX_RENDER_URL` (ou com o sidecar fora), a camada 1 é um no-op barato
  // (circuito) e o comportamento é exatamente o de antes.
  const rendered = await renderHtmlViaSidecar(url, headers, abortMs)
  if (rendered) return rendered

  if (!ENDPOINT) return null
  return flareSolverrFetch(url, 60000, abortMs, session)
}
