// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

// A busca do AnimePlanet parou de achar cartões sem nada acusar: o markup atual (conferido em
// 06/10/2026) traz o `title` — com o HTML escapado do tooltip — ANTES do `href`, e o regex
// exigia o contrário. "Solo Leveling" tinha 4 cartões reais e o parser devolvia 0; só o
// fallback de slug direto salvava, e ele só funciona quando o título vira exatamente o slug.
// As fixtures são recortes REAIS das páginas daquele dia (tests/fixtures/animeplanet/).

vi.mock("@/lib/external/flaresolverr", () => ({
  fetchHtmlWithCfFallback: vi.fn(),
  isCfBypassUnavailable: vi.fn(() => false),
}))

import {
  fetchAnimePlanetByTitle,
  parseAnimePlanetSearchCards,
  searchAnimePlanet,
} from "@/lib/external/animeplanet"
import { fetchHtmlWithCfFallback } from "@/lib/external/flaresolverr"
import { GET } from "@/app/api/animeplanet/route"
import { NextRequest } from "next/server"

const fixture = (name: string) => readFileSync(join(__dirname, "../../fixtures/animeplanet", name), "utf8")
const BUSCA = fixture("busca-solo-leveling-2026-10.html")
const SEM_RESULTADO = fixture("busca-sem-resultado-2026-10.html")
const DETALHE = fixture("detalhe-solo-leveling-2026-10.html")

// Formato ANTIGO (href antes de title, nome no title). Sintético: a fonte não serve mais assim,
// mas o parser segue aceitando — o AP já alternou de formato uma vez.
const BUSCA_FORMATO_ANTIGO = `<ul class="cardDeck">
<li class="card"><a href="/manga/solo-leveling" title="Solo Leveling" class="tooltip"><div class="crop"><img data-src="/images/manga/solo-leveling.jpg"></div></a>
<p>E-class hunter Jinwoo Sung is the weakest of them all.</p><span class="iconYear">2018</span></li>
<li class="card"><a href="/manga/only-i-level-up-novel" title="Only I Level Up (Novel)" class="tooltip"></a></li>
</ul>`

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)

/** Roteia as páginas do AP pelo caminho pedido. */
function serve(pages: Record<string, string>) {
  fetchHtml.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname + new URL(url).search
    const key = Object.keys(pages).find((k) => path.startsWith(k))
    return key ? { html: pages[key], finalUrl: url } : null
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("parseAnimePlanetSearchCards — markup real atual (title ANTES de href)", () => {
  it("acha os 4 cartões de 'Solo Leveling', com o nome tirado do <h5> do tooltip", () => {
    const cards = parseAnimePlanetSearchCards(BUSCA)
    expect(cards.map((c) => [c.slug, c.title])).toEqual([
      ["solo-leveling", "Solo Leveling"],
      ["only-i-level-up-novel", "Only I Level Up (Novel)"],
      ["solo-leveling-ragnarok-novel", "Solo Leveling: Ragnarok (Novel)"],
      ["solo-leveling-ragnarok", "Solo Leveling: Ragnarok"],
    ])
  })

  it("o trecho de cada cartão é o DELE — não engole os cartões seguintes", () => {
    const [solo, novel] = parseAnimePlanetSearchCards(BUSCA)
    expect(solo.chunk).toMatch(/E-class hunter Jinwoo Sung/)
    expect(solo.chunk).not.toMatch(/only-i-level-up-novel/)
    expect(novel.chunk).not.toMatch(/solo-leveling-ragnarok/)
  })

  it("formato antigo (href antes de title) continua aceito", () => {
    expect(parseAnimePlanetSearchCards(BUSCA_FORMATO_ANTIGO).map((c) => [c.slug, c.title])).toEqual([
      ["solo-leveling", "Solo Leveling"],
      ["only-i-level-up-novel", "Only I Level Up (Novel)"],
    ])
  })

  it("'No results found': zero cartões — o campo de busca e o filtro ecoando a query não viram resultado", () => {
    expect(parseAnimePlanetSearchCards(SEM_RESULTADO)).toEqual([])
  })
})

describe("searchAnimePlanet com o markup atual", () => {
  it("devolve os cartões da LISTA (sem precisar do fallback), filtrando as versões Novel", async () => {
    serve({ "/manga/all": BUSCA })

    const results = await searchAnimePlanet("Solo Leveling")

    expect(results.map((r) => r.id)).toEqual(["animeplanet:solo-leveling", "animeplanet:solo-leveling-ragnarok"])
    expect(results[0]).toMatchObject({ title: "Solo Leveling", year: 2018 })
    expect(results[0].synopsis).toMatch(/E-class hunter/)
    expect(results[0].coverUrl).toMatch(/^https:\/\/cdn\.anime-planet\.com\/manga\/primary\/solo-leveling/)
    // Uma página só: a lista. O fallback de slug direto não entrou.
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it("'No results found' ainda cai no fallback de slug direto, que continua funcionando", async () => {
    serve({ "/manga/all": SEM_RESULTADO, "/manga/solo-leveling": DETALHE })

    const results = await searchAnimePlanet("Solo Leveling")

    expect(results.map((r) => [r.id, r.title])).toEqual([["animeplanet:solo-leveling", "Solo Leveling"]])
  })

  it("findSlug (detalhe sem slug conhecido) acha o cartão na lista e abre a página certa", async () => {
    serve({ "/manga/all": BUSCA, "/manga/solo-leveling": DETALHE })

    await fetchAnimePlanetByTitle("Solo Leveling")

    const paths = fetchHtml.mock.calls.map(([url]) => new URL(url).pathname)
    expect(paths).toEqual(["/manga/all", "/manga/solo-leveling"])
  })

  it("a rota /api/animeplanet usa o mesmo parser: acha o slug na lista e abre o detalhe", async () => {
    serve({ "/manga/all": BUSCA, "/manga/solo-leveling": DETALHE })

    await GET(new NextRequest("http://local.test/api/animeplanet?title=Solo%20Leveling"))

    const paths = fetchHtml.mock.calls.map(([url]) => new URL(url).pathname)
    expect(paths).toEqual(["/manga/all", "/manga/solo-leveling"])
  })
})
