// Config do sidecar — TODOS os tempos/limites configuráveis por env, com defaults
// seguros. Ver DESIGN-COMIX-RENDER-SIDECAR.md §4/§5.

function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export const config = {
  port: num(process.env.PORT, 8790),
  origin: process.env.COMIX_ORIGIN?.trim() || "https://comix.to",
  userAgent: process.env.COMIX_USER_AGENT?.trim() || DEFAULT_UA,

  // Concorrência / fila (§5)
  maxConcurrency: num(process.env.MAX_CONCURRENCY, 3),
  maxQueue: num(process.env.MAX_QUEUE, 20),
  maxQueueWaitMs: num(process.env.MAX_QUEUE_WAIT_MS, 8000),

  // Timeouts (§4) — todos em ms
  totalTimeoutMs: num(process.env.TOTAL_TIMEOUT_MS, 20000), // teto por request → 504
  navTimeoutMs: num(process.env.NAV_TIMEOUT_MS, 12000), // page.goto
  xhrTimeoutMs: num(process.env.XHR_TIMEOUT_MS, 8000), // waitForResponse do XHR de busca

  // Ciclo de vida do browser (§3)
  maxJobsPerBrowser: num(process.env.MAX_JOBS_PER_BROWSER, 500),

  // Slice de resultados (§1)
  resultLimitDefault: num(process.env.RESULT_LIMIT_DEFAULT, 12),
  resultLimitMax: num(process.env.RESULT_LIMIT_MAX, 28),

  // --- POST /render (browser real no lugar do FlareSolverr) ---
  // Teto por request de render. Páginas pesadas (AnimePlanet ~725KB) levam ~5s.
  renderTimeoutMs: num(process.env.RENDER_TIMEOUT_MS, 25000),
  renderNavTimeoutMs: num(process.env.RENDER_NAV_TIMEOUT_MS, 20000),
  // Quando o CF serve o interstitial, o browser real costuma resolvê-lo sozinho em
  // poucos segundos. Esperamos o conteúdo trocar antes de desistir (→ upstream_blocked).
  renderChallengeWaitMs: num(process.env.RENDER_CHALLENGE_WAIT_MS, 12000),
  // Teto da espera pelo DOM estabilizar (conteúdo lazy de SPA — ver waitForDomSettle).
  renderSettleMaxMs: num(process.env.RENDER_SETTLE_MAX_MS, 4000),
  // Allowlist de hosts (SSRF): sem isso o /render seria um proxy aberto na rede interna.
  // Precisa cobrir TODOS os domínios que o app realmente busca — o ComicK, por exemplo,
  // rotaciona entre .dev/.io/.app (lib/external/comick.ts COMICK_BASES), e um host de
  // fora da lista some silenciosamente como se a fonte estivesse bloqueada.
  // Subdomínios entram de graça (`api.comick.dev` casa com `comick.dev`).
  renderAllowedHosts: (process.env.RENDER_ALLOWED_HOSTS?.trim()
    ? process.env.RENDER_ALLOWED_HOSTS.split(",")
    : [
        "comix.to",
        "anime-planet.com",
        "mangago.me",
        "comick.io",
        "comick.dev",
        "comick.app",
        "mangaupdates.com",
        "mangadex.org",
      ]
  ).map((h) => h.trim().toLowerCase()).filter(Boolean),
} as const

export type Config = typeof config
