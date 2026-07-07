import { afterEach, describe, expect, it, vi } from "vitest"
import { httpComixRenderClient } from "@/lib/external/comix-render-client"
import fixture from "@/tests/fixtures/comix-render/browse-relevance-i-adopted.json"

const INPUT = { title: "I Adopted the Protagonist, and the Genre Changed", anilistId: 200573 }

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => Promise.resolve(impl(url, init))))
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

describe("httpComixRenderClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("sem COMIX_RENDER_URL → 'disabled' e NÃO chama fetch", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r).toEqual({ ok: false, error: "disabled", meta: expect.any(Object) })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("chama POST {base}/resolve com o body do contrato", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar:8790")
    let seenUrl = ""
    let seenBody: unknown
    stubFetch((url, init) => {
      seenUrl = url
      seenBody = JSON.parse(String(init.body))
      return jsonResponse(fixture)
    })
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(seenUrl).toBe("http://sidecar:8790/resolve")
    expect(seenBody).toEqual({ ...INPUT, limit: 12 })
    expect(r.ok).toBe(true)
  })

  it("valida a resposta com Zod: payload válido passa", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar")
    stubFetch(() => jsonResponse(fixture))
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.items[0].hid).toBe("3ezr0")
  })

  it("payload INVÁLIDO (item sem hid) → 'invalid_response' (não aceita em silêncio)", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar")
    const bad = { ok: true, items: [{ url: "/title/x", title: "X" }], meta: fixture.meta }
    stubFetch(() => jsonResponse(bad))
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r).toEqual({ ok: false, error: "invalid_response", meta: expect.any(Object) })
  })

  it("payload sem 'ok' (forma desconhecida) → 'invalid_response'", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar")
    stubFetch(() => jsonResponse({ results: [] }))
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r).toEqual({ ok: false, error: "invalid_response", meta: expect.any(Object) })
  })

  it("erro de resposta bem-formado passa pelo schema (ok:false)", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar")
    stubFetch(() => jsonResponse({ ok: false, error: "busy", meta: { elapsedMs: 3, source: "s" } }, 503))
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r).toEqual({ ok: false, error: "busy", meta: { elapsedMs: 3, source: "s" } })
  })

  it("HTTP 5xx → retry (2 tentativas) e depois 'network_error'", async () => {
    vi.stubEnv("COMIX_RENDER_URL", "http://sidecar")
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse({ boom: true }, 500)))
    vi.stubGlobal("fetch", fetchSpy)
    const r = await httpComixRenderClient.resolve(INPUT, 12)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("network_error")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
