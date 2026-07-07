import http from "node:http"
import crypto from "node:crypto"
import { config } from "./config.js"
import { log } from "./logger.js"
import { metrics } from "./metrics.js"
import { Semaphore, BusyError } from "./pool.js"
import { initBrowser, isReady, closeBrowser, recycleIfNeeded } from "./browser.js"
import { resolveWork } from "./resolve.js"
import type { ResolveInput } from "./resolve.js"
import { ERROR_STATUS, SOURCE } from "./contract.js"
import type { SidecarResponse } from "./contract.js"

const sem = new Semaphore(config.maxConcurrency, config.maxQueue, config.maxQueueWaitMs)
metrics.setGaugeSource(() => ({ inflight: sem.inFlight, queue: sem.queueLength, ready: isReady() ? 1 : 0 }))

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) })
  res.end(payload)
}

function readBody(req: http.IncomingMessage, limitBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > limitBytes) {
        reject(new Error("body_too_large"))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function statusFor(resp: SidecarResponse): number {
  if (resp.ok) return 200
  return ERROR_STATUS[resp.error] ?? 500
}

function parseInput(raw: string): ResolveInput | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const title = typeof b.title === "string" ? b.title.trim() : ""
  if (!title) return null
  return {
    title,
    anilistId: typeof b.anilistId === "number" ? b.anilistId : undefined,
    malId: typeof b.malId === "number" ? b.malId : undefined,
    mangaUpdatesId: typeof b.mangaUpdatesId === "string" ? b.mangaUpdatesId : undefined,
  }
}

function clampLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return config.resultLimitDefault
  return Math.min(Math.floor(n), config.resultLimitMax)
}

async function handleResolve(req: http.IncomingMessage, res: http.ServerResponse, reqId: string): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    sendJson(res, 400, { ok: false, error: "bad_request", meta: { elapsedMs: 0, source: SOURCE } })
    return
  }
  const input = parseInput(raw)
  if (!input) {
    sendJson(res, 400, { ok: false, error: "bad_request", meta: { elapsedMs: 0, source: SOURCE } })
    return
  }
  const limit = clampLimit((JSON.parse(raw) as { limit?: unknown }).limit)

  // Backpressure: adquire slot (ou 503 busy).
  let queueWaitMs: number
  try {
    queueWaitMs = await sem.acquire()
    metrics.queueWaitMs.observe(queueWaitMs)
  } catch (err) {
    if (err instanceof BusyError) {
      metrics.resolveErrors.inc("busy")
      log("warn", "resolve_busy", { reqId, query: input.title, queueLength: sem.queueLength })
      sendJson(res, 503, { ok: false, error: "busy", meta: { elapsedMs: 0, source: SOURCE } })
      return
    }
    throw err
  }

  try {
    const result = await resolveWork(input, limit, reqId)
    sendJson(res, statusFor(result), result)
  } catch (err) {
    log("error", "resolve_unhandled", { reqId, detail: String(err) })
    sendJson(res, 500, { ok: false, error: "internal", meta: { elapsedMs: 0, source: SOURCE } })
  } finally {
    sem.release()
    // Recicla o browser se atingiu o teto de jobs E ninguém mais está usando.
    await recycleIfNeeded(sem.inFlight === 0)
  }
}

const server = http.createServer((req, res) => {
  const incoming = req.headers["x-correlation-id"] ?? req.headers["x-request-id"]
  const reqId = (Array.isArray(incoming) ? incoming[0] : incoming) || crypto.randomUUID()
  res.setHeader("X-Request-Id", reqId)

  const path = (req.url ?? "/").split("?")[0]

  // Liveness: só diz que o PROCESSO está vivo (não abre browser).
  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" })
    return
  }
  // Readiness: 200 só quando o BROWSER está inicializado e apto. Deixa o Fly
  // esperar o navegador subir antes de rotear tráfego.
  if (req.method === "GET" && path === "/ready") {
    if (isReady()) sendJson(res, 200, { status: "ready" })
    else sendJson(res, 503, { status: "not_ready" })
    return
  }
  if (req.method === "GET" && path === "/metrics") {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" })
    res.end(metrics.render())
    return
  }
  if (req.method === "POST" && path === "/resolve") {
    void handleResolve(req, res, reqId)
    return
  }
  sendJson(res, 404, { ok: false, error: "not_found" })
})

async function main(): Promise<void> {
  // Aquece o browser ANTES de aceitar tráfego → /ready fica verde só quando apto.
  await initBrowser().catch((err) => log("error", "initial_browser_launch_failed", { detail: String(err) }))
  server.listen(config.port, () => log("info", "listening", { port: config.port, concurrency: config.maxConcurrency }))
}

async function shutdown(signal: string): Promise<void> {
  log("info", "shutdown", { signal })
  server.close()
  await closeBrowser()
  process.exit(0)
}
process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))

void main()
