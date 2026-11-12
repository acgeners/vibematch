// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A obra criada sem o Anime-Planet (2 das 18 de 30 dias até 2026-11-12) tinha duas causas
// encadeadas: (1) a busca dele devolvia "nenhum resultado" quando NÃO conseguia buscar, então o
// diálogo dizia "Nenhum match nesta fonte"; (2) mesmo marcada como falha, nada a buscava de novo
// — o "Será re-tentada ao confirmar" do diálogo só era verdade para o ComicK.

vi.mock("@/lib/external/flaresolverr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/flaresolverr")>()),
  fetchHtmlWithCfFallback: vi.fn(async () => null),
  isCfBypassUnavailable: vi.fn(() => false),
}))

import { searchAnimePlanet } from "@/lib/external/animeplanet"
import { fetchHtmlWithCfFallback, isCfBypassUnavailable } from "@/lib/external/flaresolverr"

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)
const bypassFora = vi.mocked(isCfBypassUnavailable)

beforeEach(() => {
  vi.clearAllMocks()
  fetchHtml.mockResolvedValue(null)
  bypassFora.mockReturnValue(false)
})

describe("searchAnimePlanet — falha é falha, não 'nenhum resultado'", () => {
  it("🔴 bypass indisponível: LANÇA (a fonte vai para failedSources)", async () => {
    bypassFora.mockReturnValue(true)
    await expect(searchAnimePlanet("Obra")).rejects.toThrow(/bypass/)
  })

  it("🔴 a página de busca não abriu e o slug direto também não: LANÇA", async () => {
    await expect(searchAnimePlanet("Obra")).rejects.toThrow(/página de busca/)
  })

  it("a página de busca abriu e não tinha a obra: [] (busquei e não achei)", async () => {
    fetchHtml.mockResolvedValue({ html: "<html><body>nada</body></html>", finalUrl: "https://www.anime-planet.com/manga/all?name=Obra" } as never)
    await expect(searchAnimePlanet("Obra")).resolves.toEqual([])
  })
})

describe("retryFailedSearchSources — a nova tentativa ao confirmar", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/external/animeplanet")
    vi.resetModules()
  })

  async function carregar(apResultados: unknown[]) {
    vi.resetModules()
    const ap = vi.fn(async () => apResultados)
    vi.doMock("@/lib/external/animeplanet", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/external/animeplanet")>()),
      searchAnimePlanet: ap,
    }))
    vi.spyOn(console, "log").mockImplementation(() => {})
    const mod = await import("@/lib/external/index")
    return { ap, retry: mod.retryFailedSearchSources }
  }
  const achado = { id: "animeplanet:obra-nova", source: "animeplanet", title: "Obra Nova" }

  it("🔴 fonte que falhou na busca é buscada de novo e entra no candidato", async () => {
    const { ap, retry } = await carregar([achado])
    const candidato = { title: "Obra Nova", sources: ["mangaupdates"], retrySearchSources: ["animeplanet"] } as never
    await expect(retry(candidato)).resolves.toEqual(["animeplanet"])
    expect(ap).toHaveBeenCalled()
    expect((candidato as { animePlanetSlug?: string }).animePlanetSlug).toBe("obra-nova")
  })

  it("sem pedido de nova tentativa, não busca nada", async () => {
    const { ap, retry } = await carregar([achado])
    await expect(retry({ title: "Obra Nova", sources: ["mangaupdates"] } as never)).resolves.toEqual([])
    expect(ap).not.toHaveBeenCalled()
  })

  it("fonte já presente, ou o ComicK (que tem nova tentativa própria), fica de fora", async () => {
    const { ap, retry } = await carregar([achado])
    const candidato = { title: "Obra Nova", sources: ["animeplanet"], retrySearchSources: ["animeplanet", "comick"] } as never
    await expect(retry(candidato)).resolves.toEqual([])
    expect(ap).not.toHaveBeenCalled()
  })
})

describe("fetchMultiSourceDetails — o Anime-Planet achado na nova tentativa é VINCULADO", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/external/animeplanet")
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("🔴 o vínculo sai nos externalIds, pelo filtro de aceitação de sempre", async () => {
    vi.resetModules()
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })))
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.doMock("@/lib/external/animeplanet", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/external/animeplanet")>()),
      searchAnimePlanet: vi.fn(async () => [{ id: "animeplanet:obra-nova", source: "animeplanet", title: "Obra Nova" }]),
      fetchAnimePlanetByTitle: vi.fn(async () => ({ title: "Obra Nova", rating: 4.2, votes: 120 })),
    }))
    const { fetchMultiSourceDetails } = await import("@/lib/external/index")
    const out = await fetchMultiSourceDetails({
      title: "Obra Nova",
      sources: [],
      retrySearchSources: ["animeplanet"],
    } as never)
    expect(out.data.externalIds?.animeplanet).toBe("obra-nova")
    expect(out.data.apRating).toBe(4.2)
  })
})
