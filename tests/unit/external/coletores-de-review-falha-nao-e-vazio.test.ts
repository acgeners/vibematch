// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

// AniList, Kitsu e AnimePlanet transformavam QUALQUER falha em `[]` (o MyAnimeList tem teste
// próprio, em `myanimelist-reviews.test.ts`). A coleta só põe em `failedSources` a fonte que
// LANÇA, então a falha virava "0 reviews": o lote de reviews marcava a obra como conferida e
// ela ia para o fim da fila sem as reviews daquela fonte. Mesmo defeito que derrubou o fórum do
// MangaDex em 14/11/2026.
//
// Régua: falha LANÇA; `[]` é só "não tem". O que é "não tem" foi MEDIDO em 14/11 contra as
// APIs reais: id inexistente dá 404 no AniList (e no MAL), 200 com `data: []` no Kitsu, e slug
// morto no AnimePlanet redireciona para a busca, sem nenhum `reviewBody`.
//
// Os adaptadores são os REAIS; só a rede é simulada.

const sidecar = vi.hoisted(() => ({ render: vi.fn(async (): Promise<{ html: string; finalUrl: string } | null> => null) }))
vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: sidecar.render,
  isSidecarBlockedFor: () => false,
}))
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

interface Resposta {
  ok: boolean
  status: number
  url: string
  text: () => Promise<string>
  json: () => Promise<unknown>
}
const resp = (status: number, body: unknown, url = ""): Resposta => {
  const texto = typeof body === "string" ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => texto,
    json: async () => JSON.parse(texto),
  }
}

function simular(responder: (url: string) => Resposta) {
  vi.stubGlobal("fetch", async (input: string | URL) => responder(String(input)))
}

afterEach(() => {
  vi.unstubAllGlobals()
  sidecar.render.mockReset()
  sidecar.render.mockResolvedValue(null)
})

const TEXTO = "Uma opinião longa sobre a obra, com detalhes do enredo, do ritmo e dos personagens. ".repeat(3)

describe("AniList — falha lança, id inexistente é vazio", () => {
  it.each([429, 500, 503])("HTTP %i LANÇA", async (status) => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    simular(() => resp(status, ""))
    await expect(fetchAniListReviews(4242)).rejects.toThrow(new RegExp(`HTTP ${status}`))
  })

  it("rede caída LANÇA", async () => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed")
    })
    await expect(fetchAniListReviews(4242)).rejects.toThrow(/fetch failed/)
  })

  it("404 (medido: id inexistente) é vazio legítimo", async () => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    simular(() => resp(404, { errors: [{ message: "Not Found.", status: 404 }], data: { Media: null } }))
    await expect(fetchAniListReviews(4242)).resolves.toEqual([])
  })

  it("200 com erro do GraphQL e sem Media LANÇA", async () => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    simular(() => resp(200, { errors: [{ message: "Internal Server Error" }], data: { Media: null } }))
    await expect(fetchAniListReviews(4242)).rejects.toThrow(/Internal Server Error/)
  })

  it("200 com reviews devolve as reviews, com a nota", async () => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    simular(() => resp(200, { data: { Media: { reviews: { nodes: [{ summary: "Resumo", body: TEXTO, score: 80 }] } } } }))
    const out = await fetchAniListReviews(4242)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/^Nota do usuário: 8\/10\nResumo/)
  })

  it("obra sem review é vazio legítimo", async () => {
    const { fetchAniListReviews } = await import("@/lib/external/anilist")
    simular(() => resp(200, { data: { Media: { reviews: { nodes: [] } } } }))
    await expect(fetchAniListReviews(4242)).resolves.toEqual([])
  })
})

describe("Kitsu — falha lança, obra sem reação é vazio", () => {
  const reacao = { attributes: { reaction: TEXTO, upVotesCount: 3 } }

  it("as duas páginas falhando LANÇA", async () => {
    const { fetchKitsuReactions } = await import("@/lib/external/kitsu")
    simular(() => resp(503, ""))
    await expect(fetchKitsuReactions("4242")).rejects.toThrow(/HTTP 503/)
  })

  it("resposta sem `data[]` nas duas páginas LANÇA", async () => {
    const { fetchKitsuReactions } = await import("@/lib/external/kitsu")
    simular(() => resp(200, { errors: [{ title: "Erro" }] }))
    await expect(fetchKitsuReactions("4242")).rejects.toThrow(/sem data/)
  })

  it("uma página falha e a outra responde: devolve a que respondeu", async () => {
    const { fetchKitsuReactions } = await import("@/lib/external/kitsu")
    simular((url) => (url.includes("offset") ? resp(503, "") : resp(200, { data: [reacao] })))
    await expect(fetchKitsuReactions("4242")).resolves.toHaveLength(1)
  })

  it("200 com `data: []` (medido: também o id inexistente) é vazio legítimo", async () => {
    const { fetchKitsuReactions } = await import("@/lib/external/kitsu")
    simular(() => resp(200, { data: [], meta: { count: 0 } }))
    await expect(fetchKitsuReactions("4242")).resolves.toEqual([])
  })
})

describe("AnimePlanet — falha do bypass lança, slug morto é vazio", () => {
  const SLUG = "obra-ficticia"
  const PAGINA_REVIEWS = `<html><h1 itemprop="name">Obra Fictícia - Reviews</h1><div itemprop="reviewBody" class="userContent">${TEXTO}</div></html>`
  const BUSCA = `<html><h1>You searched for ${SLUG}</h1></html>`
  const DESAFIO = "<html><title>Just a moment...</title></html>"

  it("Cloudflare bloqueia e nenhum bypass resolve: LANÇA", async () => {
    const { fetchAnimePlanetReviews } = await import("@/lib/external/animeplanet")
    simular((url) => resp(403, DESAFIO, url))
    await expect(fetchAnimePlanetReviews(SLUG)).rejects.toThrow(/bypass não resolveu/)
  })

  it("o bypass devolve a própria página de desafio: LANÇA", async () => {
    const { fetchAnimePlanetReviews } = await import("@/lib/external/animeplanet")
    simular((url) => resp(403, DESAFIO, url))
    sidecar.render.mockResolvedValue({ html: DESAFIO, finalUrl: `https://www.anime-planet.com/manga/${SLUG}/reviews` })
    await expect(fetchAnimePlanetReviews(SLUG)).rejects.toThrow(/desafio/)
  })

  it("página de reviews devolve as reviews", async () => {
    const { fetchAnimePlanetReviews } = await import("@/lib/external/animeplanet")
    simular((url) => resp(403, DESAFIO, url))
    sidecar.render.mockResolvedValue({ html: PAGINA_REVIEWS, finalUrl: `https://www.anime-planet.com/manga/${SLUG}/reviews` })
    await expect(fetchAnimePlanetReviews(SLUG)).resolves.toHaveLength(1)
  })

  it("slug morto (redireciona para a busca) é vazio legítimo", async () => {
    const { fetchAnimePlanetReviews } = await import("@/lib/external/animeplanet")
    simular((url) => resp(403, DESAFIO, url))
    sidecar.render.mockResolvedValue({ html: BUSCA, finalUrl: `https://www.anime-planet.com/search.php?search=${SLUG}` })
    await expect(fetchAnimePlanetReviews(SLUG)).resolves.toEqual([])
  })
})

describe("na coleta de reviews, as quatro falhas entram em failedSources", () => {
  it("AniList, MAL, Kitsu e AnimePlanet fora do ar não viram '0 reviews'", async () => {
    const { collectReviewsFromCandidate } = await import("@/lib/external/index")
    simular((url) => resp(503, "", url))
    const out = await collectReviewsFromCandidate({
      title: "Obra Fictícia",
      sources: ["anilist", "myanimelist", "kitsu", "animeplanet"],
      anilistId: 4242,
      malId: 4242,
      kitsuId: "4242",
      animePlanetSlug: "obra-ficticia",
      matchScore: 1,
    } as Parameters<typeof collectReviewsFromCandidate>[0])
    expect([...out.failedSources].sort()).toEqual(["anilist", "animeplanet", "kitsu", "myanimelist"])
    expect(out.reviews).toEqual([])
  })

  it("com as quatro respondendo 'não tem', nenhuma entra em failedSources", async () => {
    const { collectReviewsFromCandidate } = await import("@/lib/external/index")
    simular((url) => {
      if (url.includes("anilist")) return resp(404, { data: { Media: null } }, url)
      if (url.includes("myanimelist")) return resp(404, "", url)
      if (url.includes("kitsu")) return resp(200, { data: [] }, url)
      return resp(403, "<html><title>Just a moment...</title></html>", url)
    })
    sidecar.render.mockResolvedValue({ html: "<html><h1>You searched for x</h1></html>", finalUrl: "https://www.anime-planet.com/search.php?search=x" })
    const out = await collectReviewsFromCandidate({
      title: "Obra Fictícia",
      sources: ["anilist", "myanimelist", "kitsu", "animeplanet"],
      anilistId: 4242,
      malId: 4242,
      kitsuId: "4242",
      animePlanetSlug: "obra-ficticia",
      matchScore: 1,
    } as Parameters<typeof collectReviewsFromCandidate>[0])
    expect(out.failedSources).toEqual([])
  })
})
