import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseMalReviewsHtml, fetchMalReviews } from "@/lib/external/myanimelist-reviews"

// Recorte REAL da página de reviews do MAL (não um HTML de brinquedo): se o site mudar a
// marcação, o teste quebra aqui em vez de o app passar a devolver zero review em silêncio.
const FIXTURE = readFileSync(
  join(process.cwd(), "tests/fixtures/myanimelist/reviews-solo-leveling.html"),
  "utf-8"
)

describe("parseMalReviewsHtml — contra o HTML real do MAL", () => {
  it("extrai as reviews com nota e texto", () => {
    const reviews = parseMalReviewsHtml(FIXTURE)

    expect(reviews.length).toBeGreaterThanOrEqual(2)
    // A nota mora num bloco escondido por CSS (`js-hidden`): `Rating: <span class="num">4`.
    // Quem olhasse só o que a página EXIBE concluiria que review do MAL não tem nota.
    expect(reviews[0].score).toBe(4)
    expect(reviews[1].score).toBe(10)
    expect(reviews[0].text).toContain("Solo Leveling")
  })

  it("devolve texto limpo: sem tags, sem entidades HTML, sem espaço duplicado", () => {
    const [primeira] = parseMalReviewsHtml(FIXTURE)

    expect(primeira.text).not.toMatch(/<[^>]+>/)
    expect(primeira.text).not.toMatch(/&(amp|quot|nbsp|#0?39);/)
    expect(primeira.text).not.toMatch(/\s{2,}/)
    expect(primeira.text.length).toBeGreaterThan(500)
  })

  it("HTML sem review nenhuma devolve lista vazia (não explode)", () => {
    expect(parseMalReviewsHtml("<html><body>nada aqui</body></html>")).toEqual([])
  })
})

describe("fetchMalReviews — a URL", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("SEMPRE inclui um segmento de slug — sem ele o MAL serve a página de DETALHE", async () => {
    // Esta é a armadilha que motivou o teste: `/manga/{id}/reviews` NÃO dá erro. O MAL
    // trata "reviews" como se fosse o slug do título e devolve o DETALHE da obra, com
    // apenas ~3 reviews de amostra — HTTP 200, HTML válido, dado errado. Medido:
    // com slug = 20 reviews; sem slug = 3. O slug em si é ignorado, mas precisa existir.
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    vi.stubGlobal("fetch", f)

    await fetchMalReviews(121496)

    const url = String(f.mock.calls[0][0])
    expect(url).toMatch(/\/manga\/121496\/[^/]+\/reviews/)
    expect(url).not.toMatch(/\/manga\/121496\/reviews/)
  })

  it("pede preliminary+spoiler — sem isso, manhwa EM ANDAMENTO devolve quase nada", async () => {
    // A maioria das reviews de obra em curso fica marcada como "preliminary" no MAL e é
    // filtrada por padrão. Como o catálogo é majoritariamente manhwa em andamento, sem
    // este filtro a fonte pareceria vazia (medido: uma obra saltou de 0 → 1 só com ele).
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    vi.stubGlobal("fetch", f)

    await fetchMalReviews(121496)

    expect(String(f.mock.calls[0][0])).toContain("preliminary=on")
    expect(String(f.mock.calls[0][0])).toContain("spoiler=on")
  })

  it("formata no contrato do app: a nota do usuário vira cabeçalho da review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    )

    const reviews = await fetchMalReviews(121496)

    expect(reviews[0]).toMatch(/^Nota do usuário: 4\/10\n/)
    expect(reviews.every((r) => r.length <= 900)).toBe(true)
  })

  it("HTTP de erro não quebra o caller — a obra só fica sem review do MAL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" }))

    await expect(fetchMalReviews(121496)).resolves.toEqual([])
  })

  it("busca as páginas em SEQUÊNCIA, não em paralelo (educação com o site)", async () => {
    // Num backfill de centenas de obras, duas requisições simultâneas por obra ao mesmo
    // host é o tipo de coisa que faz um site legítimo te bloquear.
    let emVoo = 0
    let picoSimultaneo = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        emVoo += 1
        picoSimultaneo = Math.max(picoSimultaneo, emVoo)
        await new Promise((r) => setTimeout(r, 5))
        emVoo -= 1
        return { ok: true, status: 200, text: async () => FIXTURE }
      })
    )

    await fetchMalReviews(121496)

    expect(picoSimultaneo).toBe(1)
  })
})
