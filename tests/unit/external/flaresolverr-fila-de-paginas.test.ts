// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A fila única de páginas do FlareSolverr (FLARESOLVERR_MAX_CONCURRENCY = 1).
//
// Por que existe: em 05/10/2026 a "Buscar fontes" disparou as variantes de título em
// paralelo, cada uma abrindo um Chrome no FlareSolverr da Fly (máquina de 1 GB). A memória
// zerou em 10 minutos e ele ficou mudo por horas — e o app seguia mandando páginas, porque
// abandonar a espera aqui NÃO fecha o Chrome lá. Medido no FlareSolverr local, a mesma ação
// abriu 19 páginas com pico de 6 simultâneas (+1,07 GB).
//
// O que este arquivo prova, com o relógio controlado (fake timers) e o FlareSolverr simulado:
// nunca há duas páginas abertas ao mesmo tempo; fetch direto não espera a fila; o slot volta
// depois de sucesso, erro e timeout; e quem não consegue vez dentro do próprio prazo desiste
// SEM abrir página — senão a fila mandaria trabalho que ninguém mais espera.

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
}))

const FS = "http://fs.test/v1"

interface Page {
  url: string
  body: { cmd: string; url?: string; maxTimeout?: number; session?: string }
  settled: boolean
  resolve: (r: Response) => void
  reject: (e: unknown) => void
}

/** FlareSolverr simulado: cada `request.get`/`sessions.create` fica pendente até o teste
 *  responder, e respeita o abort da conexão. Fetch direto a outras URLs volta na hora. */
function simulate(opts: { directPasses?: (url: string) => boolean } = {}) {
  const pages: Page[] = []
  let open = 0
  let peak = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url !== FS) {
      if (opts.directPasses?.(url)) return new Response("<html>direto, sem desafio</html>", { status: 200 })
      return new Response("<title>Just a moment...</title>", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      })
    }
    const body = JSON.parse(String(init?.body)) as Page["body"]
    if (body.cmd === "sessions.list") return Response.json({ status: "ok", sessions: [], version: "3.5.0" })
    open++
    peak = Math.max(peak, open)
    return new Promise<Response>((resolve, reject) => {
      const page: Page = {
        url: body.url ?? body.cmd,
        body,
        settled: false,
        resolve: (r) => {
          if (page.settled) return
          page.settled = true
          open--
          resolve(r)
        },
        reject: (e) => {
          if (page.settled) return
          page.settled = true
          open--
          reject(e)
        },
      }
      init?.signal?.addEventListener("abort", () => page.reject(init.signal?.reason))
      pages.push(page)
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { pages, peak: () => peak, open: () => open }
}

const pageOk = (html = "<html>página</html>") =>
  Response.json({ status: "ok", solution: { response: html, url: "https://destino.test/" } })

// A fila mora em `globalThis` (as cópias empacotadas do módulo a compartilham), então
// `vi.resetModules` NÃO a zera: cada teste limpa a chave antes.
const PAGE_QUEUE_KEY = Symbol.for("satoria.flaresolverr.pageQueue")

async function loadFresh() {
  // Estado de MÓDULO (circuito, sessões) zerado; cada chamada devolve uma cópia nova do módulo.
  vi.resetModules()
  vi.stubEnv("FLARESOLVERR_URL", FS)
  return import("@/lib/external/flaresolverr")
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  delete (globalThis as Record<symbol, unknown>)[PAGE_QUEUE_KEY]
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("fila de páginas do FlareSolverr — limite e liberação", () => {
  it("o limite é 1 e explícito", async () => {
    const fs = await loadFresh()
    expect(fs.FLARESOLVERR_MAX_CONCURRENCY).toBe(1)
  })

  it("duas páginas pedidas juntas: a segunda só abre quando a primeira responde", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    const b = fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 30_000)
    await settle()
    expect(net.pages.map((p) => p.url)).toEqual(["https://a.test/1"])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 1, queued: 1 })

    net.pages[0].resolve(pageOk("<html>A</html>"))
    await settle()
    expect(net.pages.map((p) => p.url)).toEqual(["https://a.test/1", "https://b.test/2"])

    net.pages[1].resolve(pageOk("<html>B</html>"))
    expect((await a)?.html).toBe("<html>A</html>")
    expect((await b)?.html).toBe("<html>B</html>")
    expect(net.peak()).toBe(1)
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("cinco pedidos simultâneos (o fan-out da 'Buscar fontes'): nunca mais de uma página aberta", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const calls = [1, 2, 3, 4, 5].map((i) => fs.fetchHtmlWithCfFallback(`https://v.test/${i}`, {}, 60_000))
    for (let i = 0; i < 5; i++) {
      await settle()
      expect(net.open()).toBe(1)
      net.pages[i].resolve(pageOk(`<html>${i}</html>`))
    }
    const results = await Promise.all(calls)
    expect(results.map((r) => r?.html)).toEqual([0, 1, 2, 3, 4].map((i) => `<html>${i}</html>`))
    expect(net.peak()).toBe(1)
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("fetch direto NÃO espera a fila: com uma página em andamento, URL sem desafio volta na hora", async () => {
    const net = simulate({ directPasses: (u) => u.startsWith("https://livre.test") })
    const fs = await loadFresh()

    const gated = fs.fetchHtmlWithCfFallback("https://gated.test/x", {}, 30_000)
    await settle()
    expect(fs.flareSolverrSlotState().inUse).toBe(1)

    const direct = await fs.fetchHtmlWithCfFallback("https://livre.test/y", {}, 30_000)
    expect(direct?.html).toContain("sem desafio")
    expect(net.pages).toHaveLength(1)

    net.pages[0].resolve(pageOk())
    await gated
  })

  it("o health check (sessions.list) não entra na fila — o diagnóstico responde com o slot ocupado", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const busy = fs.fetchHtmlWithCfFallback("https://gated.test/x", {}, 30_000)
    await settle()
    expect((await fs.flareSolverrHealth()).ok).toBe(true)

    net.pages[0].resolve(pageOk())
    await busy
  })

  it("erro HTTP do FlareSolverr devolve o slot", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    net.pages[0].resolve(new Response("boom", { status: 500 }))
    expect(await a).toBeNull()
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("erro de rede devolve o slot", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    net.pages[0].reject(new TypeError("fetch failed"))
    expect(await a).toBeNull()
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })
})

describe("fila de páginas do FlareSolverr — prazo do chamador", () => {
  it("prazo vence com a página aberta: o chamador recebe null NA HORA, mas o slot só volta quando o FlareSolverr responde", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 10_000)
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await a).toBeNull()
    // O Chrome lá continua aberto: liberar agora deixaria a próxima página abrir junto.
    expect(fs.flareSolverrSlotState().inUse).toBe(1)

    net.pages[0].resolve(pageOk())
    await settle()
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("FlareSolverr travado de verdade (nunca responde): a conexão é abortada em maxTimeout + folga e o slot não fica preso", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 10_000)
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await a).toBeNull()
    expect(net.pages[0].settled).toBe(false)

    await vi.advanceTimersByTimeAsync(20_000) // folga de fechamento do Chrome
    expect(net.pages[0].settled).toBe(true)
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("quem não consegue vez dentro do próprio prazo desiste SEM abrir página", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    const b = fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 5_000)
    await settle()
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 1, queued: 1 })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(await b).toBeNull()
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 1, queued: 0 })

    net.pages[0].resolve(pageOk())
    await a
    await settle()
    expect(net.pages.map((p) => p.url)).toEqual(["https://a.test/1"])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("ganhar a vez com prazo abaixo do piso não abre página (e devolve o slot)", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const a = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 30_000)
    await settle()
    const b = fs.fetchHtmlWithCfFallback("https://b.test/2", {}, 5_000)
    await settle()
    await vi.advanceTimersByTimeAsync(4_000) // b fica com ~1 s
    net.pages[0].resolve(pageOk())
    await a
    expect(await b).toBeNull()
    expect(net.pages.map((p) => p.url)).toEqual(["https://a.test/1"])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("sem sessão o FlareSolverr para junto com o chamador; COM sessão mantém 60 s (o solve tardio ainda aquece a sessão)", async () => {
    const net = simulate()
    const fs = await loadFresh()

    const semSessao = fs.fetchHtmlWithCfFallback("https://a.test/1", {}, 15_000)
    await settle()
    expect(net.pages[0].body.maxTimeout).toBe(15_000)
    expect(net.pages[0].body.session).toBeUndefined()
    net.pages[0].resolve(pageOk())
    await semSessao

    const comSessao = fs.fetchHtmlWithCfFallback("https://comix.test/t", {}, 25_000, "comix")
    await settle()
    expect(net.pages[1].body.maxTimeout).toBe(60_000)
    expect(net.pages[1].body.session).toBe("comix")
    net.pages[1].resolve(pageOk())
    await comSessao
  })
})

describe("fila de páginas — as cópias empacotadas do módulo dividem a MESMA fila", () => {
  // O build de produção empacota flaresolverr.ts duas vezes, com ids de módulo diferentes: uma
  // cópia para as rotas /api/animeplanet e /api/comick/*, outra para páginas e server actions.
  // Aqui são duas instâncias REAIS e distintas do módulo no mesmo processo (vi.resetModules
  // entre os imports), como no servidor.
  it("uma página aberta pela cópia A faz a cópia B esperar a vez", async () => {
    const net = simulate()
    const copiaA = await loadFresh()
    const copiaB = await loadFresh()
    expect(copiaB).not.toBe(copiaA)
    expect(copiaB.fetchHtmlWithCfFallback).not.toBe(copiaA.fetchHtmlWithCfFallback)

    const rota = copiaA.fetchHtmlWithCfFallback("https://www.anime-planet.com/manga/x", {}, 30_000)
    await settle()
    const action = copiaB.fetchHtmlWithCfFallback("https://comick.io/comic/y", {}, 30_000)
    await settle()

    expect(net.pages.map((p) => p.url)).toEqual(["https://www.anime-planet.com/manga/x"])
    expect(copiaA.flareSolverrSlotState()).toEqual({ inUse: 1, queued: 1 })
    expect(copiaB.flareSolverrSlotState()).toEqual({ inUse: 1, queued: 1 })

    net.pages[0].resolve(pageOk("<html>rota</html>"))
    await settle()
    expect(net.pages.map((p) => p.url)).toEqual(["https://www.anime-planet.com/manga/x", "https://comick.io/comic/y"])
    net.pages[1].resolve(pageOk("<html>action</html>"))

    expect((await rota)?.html).toBe("<html>rota</html>")
    expect((await action)?.html).toBe("<html>action</html>")
    expect(net.peak()).toBe(1)
    expect(copiaA.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("a cópia B libera o slot que a cópia A esperava, inclusive em erro", async () => {
    const net = simulate()
    const copiaA = await loadFresh()
    const copiaB = await loadFresh()

    const b = copiaB.fetchHtmlWithCfFallback("https://b.test/1", {}, 30_000)
    await settle()
    const a = copiaA.fetchHtmlWithCfFallback("https://a.test/2", {}, 30_000)
    await settle()
    expect(net.pages).toHaveLength(1) // A está na fila da B, não abriu página própria
    net.pages[0].resolve(new Response("boom", { status: 500 }))
    expect(await b).toBeNull()
    await settle()
    expect(net.pages.map((p) => p.url)).toEqual(["https://b.test/1", "https://a.test/2"])
    net.pages[1].resolve(pageOk())
    await a
    expect(copiaA.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })
})
