// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { comixCoverUrl, fetchComixById } from "@/lib/external/comix"

// Desde ~11/2026 o `poster` da Comix vem como CAMINHO (`/images/covers/…`), servido por
// `comix.to`. Repassado cru, ele virava capa gravada que o navegador buscava no domínio do app
// (5 obras entre 12 e 14/11) e derrubava a checagem de imagem do canário ("Failed to parse URL").

const RELATIVA = "/images/covers/d5/2d/d52d1e7c50cd843c170189dead04a7918f33cb07.jpg"

describe("comixCoverUrl — a capa sai sempre absoluta", () => {
  it("caminho relativo é resolvido contra comix.to (não contra static.comix.to, onde dá 404)", () => {
    expect(comixCoverUrl({ large: RELATIVA })).toBe(`https://comix.to${RELATIVA}`)
  })

  it("URL absoluta do formato antigo passa intacta", () => {
    const antiga = "https://static.comix.to/ed64/i/4/82/6a2b4d7827554.jpg"
    expect(comixCoverUrl({ large: antiga, medium: "/x@280.jpg" })).toBe(antiga)
  })

  it("sem large, usa o medium — também resolvido", () => {
    expect(comixCoverUrl({ medium: "/images/covers/aa/bb/c@280.jpg" })).toBe(
      "https://comix.to/images/covers/aa/bb/c@280.jpg",
    )
  })

  it("large vazio não esconde o medium", () => {
    expect(comixCoverUrl({ large: "  ", medium: RELATIVA })).toBe(`https://comix.to${RELATIVA}`)
  })

  it.each([[null], [undefined], ["x"], [{}], [{ large: 42 }], [{ large: "javascript:alert(1)" }]])(
    "poster %p não vira capa",
    (poster) => {
      expect(comixCoverUrl(poster)).toBeUndefined()
    },
  )
})

describe("fetchComixById — o detalhe que o canário e o cadastro consomem", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("com o poster no formato novo, o coverUrl do detalhe é absoluto", async () => {
    const original = readFileSync(join(process.cwd(), "tests/fixtures/cloudflare/comix-detail-ok.html"), "utf8")
    const html = original.replace(
      /"poster":\{[^}]*\}/,
      `"poster":{"medium":"${RELATIVA.replace(".jpg", "@280.jpg")}","large":"${RELATIVA}"}`,
    )
    // pré-condição: a troca aconteceu — sem isto o teste passaria verde lendo a capa antiga
    expect(html).not.toBe(original)
    expect(html).toContain(`"large":"${RELATIVA}"`)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })),
    )
    const detalhe = await fetchComixById("003kd")
    expect(detalhe?.coverUrl).toBe(`https://comix.to${RELATIVA}`)
  })
})
