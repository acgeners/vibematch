// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Checagem de capítulos, lado da Comix: se a página do código salvo FALHOU (limite de pedidos,
// bloqueio, rede) e a busca não achou nada, o lookup LANÇA com o motivo. Antes ele devolvia `null`,
// e a obra ficava "não verificada" sem nenhuma pista de por quê (14/11/2026: 53 de 55 numa rodada).
// O 404 continua `null`: código morto é "não tem", e quem registra isso é a marca da migration 222.

const comix = vi.hoisted(() => ({ outcome: vi.fn(), search: vi.fn() }))
vi.mock("@/lib/external/comix", () => ({
  fetchComixByIdOutcome: comix.outcome,
  fetchComixById: vi.fn(async () => null),
  searchComix: comix.search,
  comixWorkUrl: (hid: string) => `https://comix.to/title/${hid}`,
}))
vi.mock("@/lib/external/anilist", () => ({ fetchAniListById: vi.fn(async () => null) }))
vi.mock("@/lib/external/index", () => ({ bestTitleMatch: () => 0 }))

import { getComixLatestChapter } from "@/lib/external/chapter-sources/comix"

const entrada = { title: "Obra Teste", comixHid: "abc12" }

beforeEach(() => {
  comix.outcome.mockReset()
  comix.search.mockReset()
  comix.search.mockResolvedValue([])
})

describe("getComixLatestChapter — falha tem motivo, 404 é 'não tem'", () => {
  it("página indisponível e busca vazia: LANÇA com o motivo", async () => {
    comix.outcome.mockResolvedValue({ detail: null, linkStatus: null, unavailable: "rate_limited" })
    await expect(getComixLatestChapter(entrada)).rejects.toThrow("comix indisponível (rate_limited)")
  })

  it("código morto (404): null, sem lançar", async () => {
    comix.outcome.mockResolvedValue({ detail: null, linkStatus: "not_found" })
    await expect(getComixLatestChapter(entrada)).resolves.toBeNull()
  })

  it("página respondeu sem capítulo: null, sem lançar", async () => {
    comix.outcome.mockResolvedValue({ detail: { hid: "abc12", title: "Obra Teste" }, linkStatus: "ok" })
    await expect(getComixLatestChapter(entrada)).resolves.toBeNull()
  })
})

// A ponta de dentro: `fetchComixByIdOutcome` REAL, só a rede simulada. Sem este caso, devolver o
// motivo (`unavailable`) podia sumir da função e o teste de cima, que a simula, seguiria verde.
describe("fetchComixByIdOutcome — a falha chega com o motivo", () => {
  it.each([
    [429, "rate_limited"],
    [503, "server_error"],
  ])("HTTP %i → unavailable=%s (e não um 'sem capítulo' mudo)", async (status, motivo) => {
    vi.resetModules()
    vi.doUnmock("@/lib/external/comix")
    vi.doMock("@/lib/external/comix-render-client", () => ({
      isComixRenderConfigured: () => false,
      renderHtmlViaSidecar: async () => null,
      isSidecarBlockedFor: () => false,
    }))
    vi.doMock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))
    vi.stubGlobal("fetch", async (input: string | URL) => ({
      ok: false,
      status,
      url: String(input),
      headers: new Headers(),
      text: async () => "",
    }))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const real = await import("@/lib/external/comix")
      await expect(real.fetchComixByIdOutcome("abc12")).resolves.toEqual({ detail: null, linkStatus: null, unavailable: motivo })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("404 continua sendo 'código morto', sem motivo de falha", async () => {
    vi.resetModules()
    vi.doUnmock("@/lib/external/comix")
    vi.stubGlobal("fetch", async (input: string | URL) => ({ ok: false, status: 404, url: String(input), headers: new Headers(), text: async () => "" }))
    try {
      const real = await import("@/lib/external/comix")
      await expect(real.fetchComixByIdOutcome("abc12")).resolves.toEqual({ detail: null, linkStatus: "not_found" })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
