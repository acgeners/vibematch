import type { Browser } from "playwright"
import { config } from "./config.js"
import { metrics } from "./metrics.js"
import { log } from "./logger.js"
import { getBrowser, noteJob } from "./browser.js"
import { isChallengeHtml, SOURCE_RENDER } from "./contract.js"
import type { RenderInput, RenderResponse } from "./contract.js"

/**
 * `POST /render` — busca o HTML de uma URL com um BROWSER REAL, no lugar do
 * FlareSolverr. O Chromium do Playwright atravessa o Cloudflare das fontes que hoje
 * respondem 403 `cf-mitigated` ao fetch do Node (anime-planet, mangago, comick),
 * porque o bloqueio é por fingerprint TLS/browser, não por conteúdo.
 *
 * O sidecar segue AGNÓSTICO: devolve o HTML e pronto. Parsing, matching e persistência
 * continuam sendo do app.
 */
export async function renderPage(input: RenderInput, reqId: string): Promise<RenderResponse> {
  const t0 = Date.now()
  const budgetMs = Math.min(input.timeoutMs ?? config.renderTimeoutMs, config.renderTimeoutMs)

  let browser: Browser
  try {
    browser = await getBrowser()
  } catch (err) {
    metrics.renderErrors.inc("internal")
    log("error", "render_browser_unavailable", { reqId, detail: String(err) })
    return { ok: false, error: "internal", meta: { elapsedMs: Date.now() - t0, source: SOURCE_RENDER } }
  }
  noteJob()

  const context = await browser.newContext({
    userAgent: input.headers?.["User-Agent"] ?? input.headers?.["user-agent"] ?? config.userAgent,
    extraHTTPHeaders: stripUserAgent(input.headers),
  })
  metrics.contextCreated.inc()
  let closed = false
  let timedOut = false
  const closeCtx = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
    metrics.contextClosed.inc()
  }
  // Backstop: fechar o contexto aborta o que estiver pendente (goto rejeita com
  // "Target closed"), garantindo que nada fique pendurado além do orçamento.
  const totalTimer = setTimeout(() => {
    timedOut = true
    void closeCtx()
  }, budgetMs)

  try {
    const page = await context.newPage()
    // Imagem/mídia/fonte não afetam o HTML que queremos → menos RAM e mais rápido.
    await page.route("**/*", (route) => {
      const t = route.request().resourceType()
      return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue()
    })

    const res = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(config.renderNavTimeoutMs, budgetMs),
    })
    // Conteúdo que chega DEPOIS do domcontentloaded (SPA): os comentários do ComicK,
    // por exemplo, só existem no DOM ~2s adiante — devolver cedo entregava 13 de 33
    // reviews, uma perda silenciosa. Esperar o DOM PARAR de crescer (em vez de um sleep
    // fixo ou networkidle) cobra o custo só de quem realmente está carregando algo.
    await waitForDomSettle(page, Math.min(config.renderSettleMaxMs, budgetMs - (Date.now() - t0)))
    let html = await page.content()
    let status = res?.status() ?? 0

    // Interstitial do CF: o browser real costuma resolver sozinho em alguns segundos.
    // Espera o conteúdo trocar dentro do orçamento antes de desistir.
    if (isChallengeHtml(html)) {
      const deadline = Date.now() + Math.min(config.renderChallengeWaitMs, budgetMs - (Date.now() - t0))
      while (Date.now() < deadline) {
        await page.waitForTimeout(1000)
        html = await page.content()
        if (!isChallengeHtml(html)) {
          status = 200 // o desafio passou; a página final é a real
          break
        }
      }
      if (isChallengeHtml(html)) {
        metrics.renderErrors.inc("upstream_blocked")
        const elapsedMs = Date.now() - t0
        log("warn", "render_blocked", { reqId, url: input.url, elapsedMs })
        return { ok: false, error: "upstream_blocked", meta: { elapsedMs, source: SOURCE_RENDER } }
      }
    }

    const elapsedMs = Date.now() - t0
    metrics.observeRender(elapsedMs)
    log("info", "render_ok", { reqId, url: input.url, status, bytes: html.length, elapsedMs })
    return { ok: true, html, finalUrl: page.url(), status, meta: { elapsedMs, source: SOURCE_RENDER } }
  } catch (err) {
    const elapsedMs = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    const code = timedOut || /Timeout .* exceeded|timeout|Target .*closed/i.test(msg) ? "render_timeout" : "internal"
    metrics.renderErrors.inc(code)
    log("error", "render_error", { reqId, url: input.url, code, elapsedMs, detail: msg.slice(0, 200) })
    return { ok: false, error: code, meta: { elapsedMs, source: SOURCE_RENDER } }
  } finally {
    clearTimeout(totalTimer)
    await closeCtx()
  }
}

/**
 * Espera o DOM parar de crescer (2 leituras iguais seguidas) ou o teto estourar.
 * Páginas estáticas saem em ~1 tick; SPAs ganham o tempo que precisam, sem pagar o
 * `networkidle` (que aqui custava 5,1s contra 2,4s para o mesmo conteúdo).
 */
async function waitForDomSettle(page: import("playwright").Page, maxMs: number): Promise<void> {
  if (maxMs <= 0) return
  const deadline = Date.now() + maxMs
  let last = -1
  while (Date.now() < deadline) {
    // Expressão como STRING de propósito: o tsconfig do sidecar não inclui a lib "dom"
    // (é um serviço Node), então `document` não existe no escopo de tipos daqui.
    const size = await page
      .evaluate<number>("document.documentElement.innerHTML.length")
      .catch(() => -1)
    if (size < 0) return // página/contexto morreu — quem chamou trata
    if (size === last) return
    last = size
    await page.waitForTimeout(500)
  }
}

/** O UA vai no `userAgent` do contexto; repeti-lo em extraHTTPHeaders é redundante
 *  (e o Playwright reclama de header duplicado em alguns casos). */
function stripUserAgent(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "user-agent") continue
    out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}
