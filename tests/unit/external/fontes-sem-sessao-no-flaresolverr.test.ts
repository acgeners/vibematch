// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Comix e Mangago deixaram de usar sessão NOMEADA no FlareSolverr (06/10/2026). Cada sessão
// mantinha um Chrome vivo para sempre: medido, as duas juntas prendiam ~303 MB numa máquina de
// 962 MB, e com elas uma única página pesada levava a memória livre a 24 MB e estourava.
// Sem sessão, o FlareSolverr abre um Chrome por chamada e o fecha no `finally`
// (`driver.quit()` em flaresolverr_service.py, com sucesso, erro ou timeout).
//
// O teste usa o `flaresolverr.ts` REAL — fila, prazo e fetch direto — com o FlareSolverr
// simulado, e registra todo comando que chega a ele.

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
  isSidecarBlockedFor: () => false,
}))
// O gate da Comix persiste saúde da fonte por import dinâmico — nada de banco num teste.
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

const FS = "http://fs.test/v1"
const PAGE_QUEUE_KEY = Symbol.for("satoria.flaresolverr.pageQueue")

/** Página SSR da Comix com o cache de hidratação que o extrator lê. */
const COMIX_DETALHE = `<html><script>${JSON.stringify({
  queries: {
    [JSON.stringify(["manga", "detail", "003kd"])]: {
      hid: "003kd",
      id: 117593,
      title: "Jinx",
      poster: { large: "https://static.comix.to/capa.jpg" },
    },
  },
})}</script></html>`
const pre = (obj: unknown) => `<pre>${JSON.stringify(obj)}</pre>`
const COMIX_LOOKUP = pre({ result: { thread: { id: 3155934 } } })
const COMIX_COMENTARIOS = pre({
  result: { items: [{ contentHtml: "<p>Uma opinião longa sobre a obra, com detalhes do enredo.</p>", status: "visible" }], cursor: null },
})
const MANGAGO_RECUSADO = `<html><head></head><body><p>we're sorry, the request file are not found.</p></body></html>`
const MANGAGO_DETALHE_DIRETO = `<html><head><meta property="og:title" content="Solo Leveling" /></head><body></body></html>`

interface FsCommand {
  cmd: string
  url?: string
  session?: string
}

function simulateFlareSolverr() {
  const commands: FsCommand[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== FS) {
        // Fetch DIRETO: o detalhe do Mangago passa (como pela região do app na Fly); o resto
        // toma o desafio do Cloudflare e cai no bypass.
        if (url.startsWith("https://www.mangago.me/read-manga/")) return new Response(MANGAGO_DETALHE_DIRETO, { status: 200 })
        return new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } })
      }
      const body = JSON.parse(String(init?.body)) as FsCommand
      commands.push(body)
      if (body.cmd !== "request.get") return Response.json({ status: "ok", message: "" })
      const target = body.url ?? ""
      const html = target.includes("/title/003kd")
        ? COMIX_DETALHE
        : target.includes("/threads/lookup")
          ? COMIX_LOOKUP
          : target.includes("/comments")
            ? COMIX_COMENTARIOS
            : MANGAGO_RECUSADO
      return Response.json({ status: "ok", message: "Challenge not detected!", solution: { response: html, url: target } })
    }),
  )
  return commands
}

async function loadAdapters() {
  vi.resetModules()
  vi.stubEnv("FLARESOLVERR_URL", FS)
  const comix = await import("@/lib/external/comix")
  const mangago = await import("@/lib/external/mangago")
  const fs = await import("@/lib/external/flaresolverr")
  return { comix, mangago, fs }
}

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[PAGE_QUEUE_KEY]
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("Comix sem sessão no FlareSolverr", () => {
  it("detalhe e reviews seguem o mesmo contrato, e NENHUM comando leva sessão", async () => {
    const commands = simulateFlareSolverr()
    const { comix, fs } = await loadAdapters()

    const detalhe = await comix.fetchComixById("003kd")
    const reviews = await comix.fetchComixReviews("003kd")

    expect(detalhe).toMatchObject({ hid: "003kd", title: "Jinx", coverUrl: "https://static.comix.to/capa.jpg" })
    expect(reviews).toEqual(["Uma opinião longa sobre a obra, com detalhes do enredo."])
    // A cadeia inteira passou pelo bypass: detalhe (2× — o das reviews refaz), lookup, comentários.
    expect(commands.map((c) => c.cmd)).toEqual(["request.get", "request.get", "request.get", "request.get"])
    expect(commands.filter((c) => c.session !== undefined)).toEqual([])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })
})

describe("Mangago sem sessão no FlareSolverr", () => {
  it("busca e reviews vão ao bypass SEM sessão, e nunca há sessions.create", async () => {
    const commands = simulateFlareSolverr()
    const { mangago, fs } = await loadAdapters()

    await mangago.searchMangago("Solo Leveling")
    await mangago.fetchMangagoReviews("solo_leveling")

    const urls = commands.map((c) => c.url ?? c.cmd)
    expect(urls.some((u) => u.includes("/r/l_search/"))).toBe(true)
    expect(urls.some((u) => u.includes("/home/manga/discussion/"))).toBe(true)
    expect(commands.filter((c) => c.cmd !== "request.get")).toEqual([])
    expect(commands.filter((c) => c.session !== undefined)).toEqual([])
    expect(fs.flareSolverrSlotState()).toEqual({ inUse: 0, queued: 0 })
  })

  it("o detalhe que passa por fetch direto NÃO toca o FlareSolverr (fora da mudança)", async () => {
    const commands = simulateFlareSolverr()
    const { mangago } = await loadAdapters()

    const detalhe = await mangago.fetchMangagoById("solo_leveling")

    expect(detalhe?.title).toBe("Solo Leveling")
    expect(commands).toEqual([])
  })
})
