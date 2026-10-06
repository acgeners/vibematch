// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O FlareSolverr 3.5.0 devolve TODO erro como HTTP 500 + JSON `{status:"error", message:"Error: …"}`.
// O estouro do `maxTimeout` de uma página chega assim (conferido contra o serviço real em
// 06/10/2026):
//   {"status": "error", "message": "Error: Error solving the challenge. Timeout after 1.0 seconds.", …}
// Desde o PR #534 o `maxTimeout` acompanha o prazo do chamador, então esse 500 passou a chegar — e
// o código tratava TODO 500 como container caído, abrindo o circuito por 60 s para todas as fontes
// do bypass. Medido no rollout: uma base do ComicK estourou, as bases seguintes foram puladas e a
// rota deu 502. Este arquivo prova que o timeout de UMA página fica local, que falha real do
// serviço continua abrindo o circuito, e o piso de prazo para abrir página.

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
  isSidecarBlockedFor: () => false,
}))

const FS = "http://fs.test/v1"
const PAGE_QUEUE_KEY = Symbol.for("satoria.flaresolverr.pageQueue")

const json500 = (message: string) =>
  new Response(JSON.stringify({ status: "error", message, startTimestamp: 1, endTimestamp: 2, version: "3.5.0" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  })
/** O timeout da página, exatamente como o FlareSolverr 3.5.0 o devolve. */
const pageTimeout = (seconds: string) => json500(`Error: Error solving the challenge. Timeout after ${seconds} seconds.`)
/** Falha REAL do serviço, no mesmo envelope — a mensagem do travamento de 05/10/2026. */
const chromeDown = () =>
  json500(
    "Error: Error solving the challenge. session not created: cannot connect to chrome at 127.0.0.1:33197\\nfrom chrome not reachable",
  )
const pageOk = (html = "<html>página</html>") =>
  Response.json({ status: "ok", message: "Challenge not detected!", solution: { response: html, url: "https://destino.test/" } })

interface Page {
  url: string
  body: { cmd: string; url?: string; maxTimeout?: number }
  resolve: (r: Response) => void
}

/** FlareSolverr simulado: cada página fica pendente até o teste responder. Fetch direto a outras
 *  URLs toma o desafio do Cloudflare (cai no bypass). */
function simulate() {
  const pages: Page[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== FS) return new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } })
      const body = JSON.parse(String(init?.body)) as Page["body"]
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        pages.push({ url: body.url ?? body.cmd, body, resolve })
      })
    }),
  )
  return pages
}

async function loadFresh() {
  vi.resetModules()
  vi.stubEnv("FLARESOLVERR_URL", FS)
  return import("@/lib/external/flaresolverr")
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[PAGE_QUEUE_KEY]
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("classificação da resposta de erro do FlareSolverr", () => {
  it("reconhece SÓ a frase exata de timeout da página", async () => {
    const { isFlareSolverrPageTimeout } = await loadFresh()
    const body = (message: unknown, status: unknown = "error") => ({ status, message })
    expect(isFlareSolverrPageTimeout(body("Error: Error solving the challenge. Timeout after 1.0 seconds."))).toBe(true)
    expect(isFlareSolverrPageTimeout(body("Error: Error solving the challenge. Timeout after 2.078 seconds."))).toBe(true)
    expect(isFlareSolverrPageTimeout(body("Error: Error solving the challenge. Timeout after 60 seconds."))).toBe(true)
    // Falha real e qualquer coisa fora do envelope: NÃO é timeout.
    expect(isFlareSolverrPageTimeout(body("Error: Error solving the challenge. session not created: cannot connect to chrome"))).toBe(false)
    expect(isFlareSolverrPageTimeout(body("Error: Request parameter 'cmd' is mandatory."))).toBe(false)
    expect(isFlareSolverrPageTimeout(body("Error: Error solving the challenge. Timeout after 1.0 seconds.", "ok"))).toBe(false)
    expect(isFlareSolverrPageTimeout(null)).toBe(false)
    expect(isFlareSolverrPageTimeout("Internal Server Error")).toBe(false)
  })
})

describe("caso A — timeout de UMA página não abre o circuito", () => {
  it("a chamada volta null, o circuito segue fechado e a próxima página abre normalmente", async () => {
    vi.useFakeTimers()
    const pages = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://www.anime-planet.com/manga/x", {}, 30_000)
    await settle()
    pages[0].resolve(pageTimeout("30.0"))
    expect(await a).toBeNull()
    expect(fs.isFlareSolverrCircuitOpen()).toBe(false)

    const b = fs.fetchHtmlWithCfFallback("https://api.comick.dev/comic/y", {}, 30_000)
    await settle()
    expect(pages).toHaveLength(2)
    pages[1].resolve(pageOk("<html>B</html>"))
    expect((await b)?.html).toBe("<html>B</html>")
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })
})

describe("caso B — falha VERDADEIRA do serviço continua abrindo o circuito", () => {
  it("500 de Chrome inalcançável: circuito abre e a próxima chamada nem abre página", async () => {
    vi.useFakeTimers()
    const pages = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    pages[0].resolve(chromeDown())
    expect(await a).toBeNull()
    expect(fs.isFlareSolverrCircuitOpen()).toBe(true)

    expect(await fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 30_000)).toBeNull()
    expect(pages).toHaveLength(1)
  })

  it("500 sem corpo JSON (resposta ilegível) também abre o circuito", async () => {
    vi.useFakeTimers()
    const pages = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    pages[0].resolve(new Response("Internal Server Error", { status: 500 }))
    expect(await a).toBeNull()
    expect(fs.isFlareSolverrCircuitOpen()).toBe(true)
  })
})

describe("caso C — piso de prazo para abrir página (5 s)", () => {
  it("restando 3 s ao ganhar a vez: não abre página, não prende o slot e não abre o circuito", async () => {
    vi.useFakeTimers()
    const pages = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    const b = fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 8_000)
    await settle()
    await vi.advanceTimersByTimeAsync(5_000) // b fica com ~3 s quando a vez chegar
    pages[0].resolve(pageOk())
    await a

    expect(await b).toBeNull()
    expect(pages.map((p) => p.url)).toEqual(["https://a.test/1"])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
    expect(fs.isFlareSolverrCircuitOpen()).toBe(false)
  })

  it("restando 6 s ao ganhar a vez: abre a página normalmente", async () => {
    vi.useFakeTimers()
    const pages = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    const b = fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 8_000)
    await settle()
    await vi.advanceTimersByTimeAsync(2_000) // b fica com ~6 s
    pages[0].resolve(pageOk())
    await a
    await settle()

    expect(pages.map((p) => p.url)).toEqual(["https://a.test/1", "https://b.test/2"])
    pages[1].resolve(pageOk("<html>B</html>"))
    expect((await b)?.html).toBe("<html>B</html>")
  })
})

describe("caso D — ComicK: uma base estoura e as seguintes continuam sendo tentadas", () => {
  it("timeout na 1ª base da API não vira falha da fonte: a 2ª base responde e o detalhe chega", async () => {
    // Relógio real: o FlareSolverr simulado responde na hora.
    const commands: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url !== FS) return new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } })
        const body = JSON.parse(String(init?.body)) as { url: string }
        commands.push(body.url)
        if (body.url.startsWith("https://api.comick.dev/")) return pageTimeout("10.0")
        return Response.json({
          status: "ok",
          message: "Challenge not detected!",
          solution: { url: body.url, response: `<pre>${JSON.stringify({ comic: { title: "Na Honjaman Level-Up" } })}</pre>` },
        })
      }),
    )
    vi.resetModules()
    vi.stubEnv("FLARESOLVERR_URL", FS)
    const { fetchComicKByHid } = await import("@/lib/external/comick")
    const fs = await import("@/lib/external/flaresolverr")

    const detalhe = await fetchComicKByHid("71gMd0vF")

    expect(detalhe?.title).toBe("Na Honjaman Level-Up")
    expect(commands.map((u) => new URL(u).host)).toEqual(["api.comick.dev", "api.comick.io"])
    expect(fs.isFlareSolverrCircuitOpen()).toBe(false)
  })
})
