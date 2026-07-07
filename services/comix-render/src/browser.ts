import { chromium } from "playwright"
import type { Browser } from "playwright"
import { config } from "./config.js"
import { metrics } from "./metrics.js"
import { log } from "./logger.js"

// Ciclo de vida do browser (§3): UM Chromium singleton, quente. Relança em
// disconnect (crash) e recicla proativamente após MAX_JOBS_PER_BROWSER — só
// quando OCIOSO (sem contexto aberto), pra não derrubar requests em andamento.

let browser: Browser | null = null
let launching: Promise<Browser> | null = null
let jobsOnCurrent = 0

async function launch(): Promise<Browser> {
  const b = await chromium.launch({
    headless: true,
    // Flags padrão pra Chromium em container.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  b.on("disconnected", () => {
    if (browser === b) {
      browser = null
      log("warn", "browser_disconnected")
    }
  })
  log("info", "browser_launched")
  return b
}

/** Garante um browser conectado (lança/relança sob demanda). Deduplica lançamentos
 *  concorrentes via `launching`. */
export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser
  if (!launching) {
    launching = launch()
      .then((b) => {
        browser = b
        jobsOnCurrent = 0
        launching = null
        return b
      })
      .catch((err) => {
        launching = null
        throw err
      })
  }
  return launching
}

/** Aquece o browser no boot (pra /ready ficar verde só quando apto). */
export async function initBrowser(): Promise<void> {
  await getBrowser()
}

/** True quando o browser está apto a atender (usado por /ready). */
export function isReady(): boolean {
  return Boolean(browser && browser.isConnected())
}

/** Marca +1 job no browser atual. */
export function noteJob(): void {
  jobsOnCurrent++
}

/** Recicla o browser se já passou do teto de jobs E está ocioso (sem contexto).
 *  Chamado após cada job com `idle = (semáforo.inFlight === 0)`. */
export async function recycleIfNeeded(idle: boolean): Promise<void> {
  if (!idle || jobsOnCurrent < config.maxJobsPerBrowser) return
  const old = browser
  browser = null
  jobsOnCurrent = 0
  metrics.browserRestarts.inc()
  log("info", "browser_recycled", { reason: "max_jobs" })
  await old?.close().catch(() => {})
  await getBrowser().catch((err) => log("error", "browser_relaunch_failed", { detail: String(err) }))
}

/** Fecha o browser no shutdown gracioso. */
export async function closeBrowser(): Promise<void> {
  const b = browser
  browser = null
  await b?.close().catch(() => {})
}
