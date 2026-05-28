// FlareSolverr is a self-hosted Docker container that runs headless Chrome to
// solve Cloudflare challenges and returns the post-challenge HTML + cookies.
// Setup:
//   docker run -d --name flaresolverr -p 8191:8191 \
//     -e LOG_LEVEL=info ghcr.io/flaresolverr/flaresolverr:latest
//   Add to .env.local: FLARESOLVERR_URL=http://localhost:8191/v1
//
// When the env var is unset, helpers fall back to a plain fetch (no CF bypass).

const ENDPOINT = process.env.FLARESOLVERR_URL?.trim() || ""

/** True when FlareSolverr is configured (env var present). */
export function isFlareSolverrEnabled(): boolean {
  return ENDPOINT.length > 0
}

/** Heuristic: is this response HTML a Cloudflare challenge page? */
export function isCloudflareChallenge(html: string): boolean {
  return /cf-mitigated|challenge-platform|Just a moment|cf-chl-bypass/i.test(html)
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

export async function flareSolverrFetch(
  url: string,
  timeoutMs = 60000
): Promise<{ html: string; finalUrl: string } | null> {
  if (!ENDPOINT) return null
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url,
        maxTimeout: timeoutMs,
      }),
      cache: "no-store",
    })
    if (!res.ok) {
      logFlareSolverrFailure(`HTTP ${res.status} — container caído ou misconfigurado?`)
      return null
    }
    const json = await res.json()
    const html = json?.solution?.response
    const finalUrl = typeof json?.solution?.url === "string" ? json.solution.url : url
    if (typeof html !== "string" || html.length === 0) {
      logFlareSolverrFailure(`resposta sem solution.response (status=${json?.status ?? "?"} message="${json?.message ?? ""}")`)
      return null
    }
    return { html, finalUrl }
  } catch (err) {
    logFlareSolverrFailure(`falha de rede (${err instanceof Error ? err.message : err}) — container provavelmente não está rodando`)
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
  headers: Record<string, string> = {}
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
  return flareSolverrFetch(url)
}
