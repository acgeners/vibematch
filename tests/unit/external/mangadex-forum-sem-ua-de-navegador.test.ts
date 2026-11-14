// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

// O fórum do MangaDex (forums.mangadex.org) passou a mandar quem se diz NAVEGADOR para um desafio
// anti-robô (`/edge/challenge`, 403). Medido em 2026-11-14 em 10 obras: com `User-Agent: Mozilla/5.0`,
// 403 nas 10; sem o cabeçalho, 200 com posts nas 10. O app mandava o `Mozilla/5.0` e tratava o 403
// como "sem comentários": as 774 obras com MangaDex pararam de receber review, sem nada acusar.
//
// O adaptador é o REAL; a API e o fórum do MangaDex são simulados.

vi.mock("@/lib/external/comix-render-client", () => ({
  isComixRenderConfigured: () => false,
  renderHtmlViaSidecar: async () => null,
  isSidecarBlockedFor: () => false,
}))
vi.mock("@/lib/external/source-health-store", () => ({ upsertSourceHealth: vi.fn(async () => {}) }))

const MD_ID = "11111111-2222-3333-4444-555555555555"
const THREAD = 4242
const POST = "Uma opinião longa sobre a obra, com detalhes do enredo, do ritmo e dos personagens. ".repeat(3)
const PAGINA = `<html><div class="bbWrapper">${POST}</div>\n</html>`

interface Resposta {
  ok: boolean
  status: number
  url: string
  text: () => Promise<string>
  json: () => Promise<unknown>
}
const resp = (status: number, body: string, url = ""): Resposta => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  text: async () => body,
  json: async () => JSON.parse(body),
})
const stats = (threadId: number | null, repliesCount = 20) =>
  resp(
    200,
    JSON.stringify({
      result: "ok",
      statistics: { [MD_ID]: threadId == null ? {} : { comments: { threadId, repliesCount } } },
    }),
  )

/** Instala um `fetch` falso; `forum(url, init)` responde as páginas do fórum. */
function simular(opts: { stats?: Resposta; forum?: (url: string) => Resposta }) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    chamadas.push({ url, init })
    if (url.includes("/statistics/manga/")) return opts.stats ?? stats(THREAD)
    if (url.includes("forums.mangadex.org")) return (opts.forum ?? (() => resp(200, PAGINA, url)))(url)
    throw new Error(`fetch inesperado: ${url}`)
  })
  return chamadas
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function userAgentDe(init?: RequestInit): string | undefined {
  const h = init?.headers
  if (!h) return undefined
  if (h instanceof Headers) return h.get("user-agent") ?? undefined
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === "user-agent")?.[1]
  const rec = h as Record<string, string>
  return Object.entries(rec).find(([k]) => k.toLowerCase() === "user-agent")?.[1]
}

describe("fórum do MangaDex — sem cabeçalho de navegador, e falha não vira zero", () => {
  it("nenhuma chamada ao fórum se apresenta como navegador", async () => {
    const { fetchMangaDexForumComments } = await import("@/lib/external/mangadex")
    const chamadas = simular({})
    const posts = await fetchMangaDexForumComments(MD_ID)
    expect(posts.length).toBeGreaterThan(0)
    const doForum = chamadas.filter((c) => c.url.includes("forums.mangadex.org"))
    expect(doForum.length).toBeGreaterThan(0)
    for (const c of doForum) expect(userAgentDe(c.init) ?? "").not.toMatch(/mozilla/i)
  })

  it("403 em todas as páginas do fórum LANÇA (não devolve 0 reviews)", async () => {
    const { fetchMangaDexForumComments, MangaDexForumUnavailableError } = await import("@/lib/external/mangadex")
    simular({ forum: (url) => resp(403, "", url) })
    await expect(fetchMangaDexForumComments(MD_ID)).rejects.toBeInstanceOf(MangaDexForumUnavailableError)
  })

  it("desafio que chega como 200 depois do redirect também é falha", async () => {
    const { fetchMangaDexForumComments, MangaDexForumUnavailableError } = await import("@/lib/external/mangadex")
    simular({ forum: () => resp(200, "Bot challenge not passed", "https://mangadex.org/edge/challenge?src=x") })
    await expect(fetchMangaDexForumComments(MD_ID)).rejects.toBeInstanceOf(MangaDexForumUnavailableError)
  })

  it("rede caída no fórum é falha", async () => {
    const { fetchMangaDexForumComments, MangaDexForumUnavailableError } = await import("@/lib/external/mangadex")
    simular({
      forum: () => {
        throw new TypeError("fetch failed")
      },
    })
    await expect(fetchMangaDexForumComments(MD_ID)).rejects.toBeInstanceOf(MangaDexForumUnavailableError)
  })

  it("uma página falha e outra responde: devolve o parcial", async () => {
    const { fetchMangaDexForumComments } = await import("@/lib/external/mangadex")
    // 200 respostas ⇒ 10 páginas ⇒ amostra de 5; só a 1ª responde.
    simular({
      stats: stats(THREAD, 200),
      forum: (url) => (url.endsWith("/page-1") ? resp(200, PAGINA, url) : resp(403, "", url)),
    })
    await expect(fetchMangaDexForumComments(MD_ID)).resolves.toHaveLength(1)
  })

  it("obra sem tópico no fórum é vazio legítimo, sem tocar o fórum", async () => {
    const { fetchMangaDexForumComments } = await import("@/lib/external/mangadex")
    const chamadas = simular({ stats: stats(null) })
    await expect(fetchMangaDexForumComments(MD_ID)).resolves.toEqual([])
    expect(chamadas.some((c) => c.url.includes("forums.mangadex.org"))).toBe(false)
  })

  it("statistics 429/5xx é falha; 404 é id que a API não conhece", async () => {
    const { fetchMangaDexForumComments, MangaDexForumUnavailableError } = await import("@/lib/external/mangadex")
    simular({ stats: resp(503, "") })
    await expect(fetchMangaDexForumComments(MD_ID)).rejects.toBeInstanceOf(MangaDexForumUnavailableError)
    simular({ stats: resp(429, "") })
    await expect(fetchMangaDexForumComments(MD_ID)).rejects.toBeInstanceOf(MangaDexForumUnavailableError)
    simular({ stats: resp(404, "") })
    await expect(fetchMangaDexForumComments(MD_ID)).resolves.toEqual([])
  })

  it("na coleta de reviews, o fórum recusado entra em failedSources", async () => {
    const { collectReviewsFromCandidate } = await import("@/lib/external/index")
    simular({ forum: (url) => resp(403, "", url) })
    const out = await collectReviewsFromCandidate({
      title: "Obra Fictícia",
      sources: ["mangadex"],
      mangadexId: MD_ID,
      matchScore: 1,
    } as Parameters<typeof collectReviewsFromCandidate>[0])
    expect(out.failedSources).toEqual(["mangadex"])
    expect(out.reviews).toEqual([])
  })
})

describe("MangaDex → MangaUpdates: o link vem como CÓDIGO da URL nova", () => {
  it("o código vira o id numérico que o app guarda", async () => {
    const { extractLinks } = await import("@/lib/external/mangadex")
    // Mesmo par conferido no teste da Comix: `s5pb9ht` = 61294752209.
    expect(extractLinks({ mu: "s5pb9ht", al: "123" })?.mu).toBe("61294752209")
    expect(Number(extractLinks({ mu: "s5pb9ht" })?.mu)).toBe(61294752209)
  })

  it("id ANTIGO (1 a 6 dígitos) não tem conversão e é descartado, não lido em base 36", async () => {
    const { extractLinks, mangaUpdatesIdFromMangaDex } = await import("@/lib/external/mangadex")
    expect(mangaUpdatesIdFromMangaDex("153486")).toBeUndefined()
    expect(extractLinks({ mu: "153486", al: "123" })?.mu).toBeUndefined()
    // Código novo só de dígitos (7 caracteres) segue sendo código.
    expect(mangaUpdatesIdFromMangaDex("1234567")).toBe(String(parseInt("1234567", 36)))
  })

  it("a busca do MangaDex entrega o MangaUpdates já numérico", async () => {
    const { searchMangaDex } = await import("@/lib/external/mangadex")
    vi.stubGlobal("fetch", async () =>
      resp(
        200,
        JSON.stringify({
          data: [{ id: MD_ID, attributes: { title: { en: "Obra Fictícia" }, links: { mu: "s5pb9ht" } } }],
        }),
      ),
    )
    const [r] = await searchMangaDex("Obra Fictícia")
    expect(r.links?.mu).toBe("61294752209")
  })
})
