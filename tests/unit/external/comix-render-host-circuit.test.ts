import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O circuito por host é ESTADO DE MÓDULO — cada teste precisa de uma instância limpa,
// senão o bloqueio aberto por um vaza para o seguinte.
async function freshClient() {
  vi.resetModules()
  return await import("@/lib/external/comix-render-client")
}

const renderResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const BLOCKED = { ok: false, error: "upstream_blocked", meta: { elapsedMs: 13200, source: "render:browser" } }
const BUSY = { ok: false, error: "busy", meta: { elapsedMs: 3, source: "render:browser" } }
const OK = {
  ok: true,
  html: "<html>conteúdo real</html>",
  finalUrl: "https://comix.to/title/0zex5",
  status: 200,
  meta: { elapsedMs: 900, source: "render:browser" },
}

const COMIX = "https://comix.to/title/0zex5"
const COMIX_OUTRA = "https://comix.to/api/v1/threads/1649636/comments"
const MANGAGO = "https://www.mangago.me/home/manga/discussion/x/"

describe("renderHtmlViaSidecar: circuito POR HOST em upstream_blocked", () => {
  beforeEach(() => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar:8790")
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("host bloqueado NÃO é sondado de novo — a 2ª chamada nem chama fetch", async () => {
    // A regressão real: a cadeia de reviews da Comix são 4 chamadas, e cada uma pagava
    // ~13,2s de espera do interstitial (~55s contra um teto de 25s ⇒ zero reviews).
    const { renderHtmlViaSidecar } = await freshClient()
    const fetchSpy = vi.fn(() => Promise.resolve(renderResponse(BLOCKED, 502)))
    vi.stubGlobal("fetch", fetchSpy)

    expect(await renderHtmlViaSidecar(COMIX)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    expect(await renderHtmlViaSidecar(COMIX_OUTRA)).toBeNull()
    expect(await renderHtmlViaSidecar(COMIX)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1) // ainda 1: as seguintes saíram pelo circuito
  })

  it("o circuito é do HOST, não global — outra fonte segue sendo tentada", async () => {
    // Sem isto, um host bloqueado derrubaria o sidecar para mangago/anime-planet/comick,
    // que ele atravessa normalmente (medido: render_ok em ~1s).
    const { renderHtmlViaSidecar } = await freshClient()
    const fetchSpy = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { url: string }
      return Promise.resolve(body.url.includes("comix.to") ? renderResponse(BLOCKED, 502) : renderResponse(OK))
    })
    vi.stubGlobal("fetch", fetchSpy)

    await renderHtmlViaSidecar(COMIX)
    await renderHtmlViaSidecar(COMIX)

    const r = await renderHtmlViaSidecar(MANGAGO)
    expect(r?.html).toContain("conteúdo real")
    expect(fetchSpy).toHaveBeenCalledTimes(2) // 1 comix (a 2ª pulou) + 1 mangago
  })

  it("'busy' NÃO abre o circuito do host — sidecar ocupado é transiente", async () => {
    // Travar 15min por sobrecarga momentânea perderia o sidecar nos hosts que ele passa.
    const { renderHtmlViaSidecar } = await freshClient()
    const fetchSpy = vi.fn(() => Promise.resolve(renderResponse(BUSY, 503)))
    vi.stubGlobal("fetch", fetchSpy)

    await renderHtmlViaSidecar(COMIX)
    await renderHtmlViaSidecar(COMIX)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("render bem-sucedido REABRE o host na hora, sem esperar o TTL", async () => {
    const { renderHtmlViaSidecar } = await freshClient()
    let bloqueado = true
    const fetchSpy = vi.fn(() => Promise.resolve(bloqueado ? renderResponse(BLOCKED, 502) : renderResponse(OK)))
    vi.stubGlobal("fetch", fetchSpy)

    await renderHtmlViaSidecar(COMIX) // abre o circuito
    expect(await renderHtmlViaSidecar(COMIX)).toBeNull() // pulou

    // Simula o TTL vencendo: o host volta a ser sondado e passa.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000)
    bloqueado = false
    expect((await renderHtmlViaSidecar(COMIX))?.html).toContain("conteúdo real")

    // Reaberto: a chamada seguinte vai ao sidecar em vez de esperar outro TTL.
    const antes = fetchSpy.mock.calls.length
    expect((await renderHtmlViaSidecar(COMIX))?.html).toContain("conteúdo real")
    expect(fetchSpy).toHaveBeenCalledTimes(antes + 1)
  })
})
