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
} as const

export type Config = typeof config
