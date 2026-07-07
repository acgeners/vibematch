import type { Browser } from "playwright"
import { config } from "./config.js"
import { metrics } from "./metrics.js"
import { log } from "./logger.js"
import { getBrowser, noteJob } from "./browser.js"
import { shapeItem, classifyError, SOURCE } from "./contract.js"
import type { SidecarResponse } from "./contract.js"

export interface ResolveInput {
  title: string
  anilistId?: number
  malId?: number
  mangaUpdatesId?: string
}

// Erros transientes valem 1 retry interno (contexto novo). `no_xhr`/`upstream_blocked`
// não retentam aqui (mudança de rota/CF não melhora com repetição imediata).
const TRANSIENT = new Set(["render_timeout", "internal"])

/** Resolve com 1 retry interno em falha transiente. */
export async function resolveWork(input: ResolveInput, limit: number, reqId: string): Promise<SidecarResponse> {
  const first = await resolveOnce(input, limit, reqId, 0)
  if (first.ok || !TRANSIENT.has(first.error)) return first
  log("warn", "resolve_retry", { reqId, afterError: first.error })
  return resolveOnce(input, limit, reqId, 1)
}

/**
 * Uma tentativa: BrowserContext EFÊMERO por request (isolamento auto), navegação
 * DIRETA pra /browse?q=&sort=relevance:desc, intercept do XHR de busca.
 * Cleanup (context.close + métrica) SEMPRE no finally — inclusive em timeout/erro.
 */
async function resolveOnce(input: ResolveInput, limit: number, reqId: string, attempt: number): Promise<SidecarResponse> {
  const t0 = Date.now()
  let phase: "nav" | "xhr" | "parse" = "nav"
  let navMs = 0
  let xhrMs = 0

  let browser: Browser
  try {
    browser = await getBrowser()
  } catch (err) {
    metrics.resolveErrors.inc("internal")
    log("error", "browser_unavailable", { reqId, detail: String(err) })
    return { ok: false, error: "internal", meta: { elapsedMs: Date.now() - t0, source: SOURCE } }
  }
  noteJob()

  // Contexto criado → conta created; closeCtx conta closed (balanço = detector de leak).
  const context = await browser.newContext({ userAgent: config.userAgent })
  metrics.contextCreated.inc()
  let closed = false
  let timedOut = false
  const closeCtx = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
    metrics.contextClosed.inc()
  }
  // Backstop de tempo total: fechar o contexto aborta ops pendentes (goto/waitForResponse
  // rejeitam com "Target closed"), garantindo que nada fique pendurado além do teto.
  const totalTimer = setTimeout(() => {
    timedOut = true
    void closeCtx()
  }, config.totalTimeoutMs)

  try {
    const page = await context.newPage()
    // Aborta imagem/mídia/fonte: não precisamos delas pra resolver → menos RAM e mais rápido.
    await page.route("**/*", (route) => {
      const t = route.request().resourceType()
      return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue()
    })

    phase = "nav"
    const nav0 = Date.now()
    const target = `${config.origin}/browse?q=${encodeURIComponent(input.title)}&sort=relevance:desc`
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: config.navTimeoutMs })
    navMs = Date.now() - nav0

    phase = "xhr"
    const xhr0 = Date.now()
    // O app do Comix injeta o token _= válido e dispara a busca por relevância.
    const resp = await page.waitForResponse(
      (r) => {
        const u = r.url()
        return u.includes("/api/v1/manga?") && u.includes("keyword") && /relevance/.test(u)
      },
      { timeout: config.xhrTimeoutMs },
    )
    xhrMs = Date.now() - xhr0

    phase = "parse"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json().catch(() => null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems: any[] = Array.isArray(json?.result?.items) ? json.result.items : []
    const items = rawItems
      .slice(0, limit)
      .map(shapeItem)
      .filter((it): it is NonNullable<typeof it> => it !== null)

    const elapsedMs = Date.now() - t0
    metrics.observeResolve({ durationMs: elapsedMs, navMs, xhrMs, candidates: rawItems.length })
    log("info", "resolve_ok", {
      reqId,
      attempt,
      query: input.title,
      totalCandidates: rawItems.length,
      returned: items.length,
      navMs,
      xhrMs,
      elapsedMs,
    })
    return {
      ok: true,
      items,
      meta: { query: input.title.trim(), elapsedMs, totalCandidates: rawItems.length, source: SOURCE },
    }
  } catch (err) {
    const elapsedMs = Date.now() - t0
    const code = classifyError(err, phase, timedOut)
    metrics.resolveErrors.inc(code)
    log("error", "resolve_error", {
      reqId,
      attempt,
      query: input.title,
      code,
      phase,
      navMs,
      xhrMs,
      elapsedMs,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: String((err as any)?.message ?? err).slice(0, 200),
    })
    return { ok: false, error: code, meta: { elapsedMs, source: SOURCE } }
  } finally {
    clearTimeout(totalTimer)
    await closeCtx()
  }
}
