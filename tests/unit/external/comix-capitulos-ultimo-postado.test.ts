// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { comixChapterCount, fetchComixById } from "@/lib/external/comix"

// A contagem de capítulos do Comix é o ÚLTIMO capítulo POSTADO (`latestChapter`), nunca o
// `finalChapter` (cadastro: o capítulo final declarado da obra). A `/reading` chama este número
// de "lançados" e calcula o que falta ler a partir dele; com o `finalChapter` na frente, ela podia
// mostrar capítulos que não existem para ler. Decidido em 2026-11-09.

// Página real do Comix (capturada em 2026-07-12): `latestChapter` 102.5, `finalChapter` 0.
const paginaReal = readFileSync(join(process.cwd(), "tests/fixtures/cloudflare/comix-detail-ok.html"), "utf8")

/** A mesma página, com o cadastro declarando um capítulo final À FRENTE do que está postado. */
function paginaComFinal(final: number): string {
  const html = paginaReal.replace('"finalChapter":0', `"finalChapter":${final}`)
  // pré-condição: a troca aconteceu — sem isto o teste passaria verde testando a página original
  expect(html).toContain(`"finalChapter":${final}`)
  return html
}

afterEach(() => vi.unstubAllGlobals())

describe("comixChapterCount — a régua", () => {
  it("usa o latestChapter mesmo com o finalChapter à frente", () => {
    expect(comixChapterCount({ latestChapter: 46, finalChapter: 120 } as { latestChapter: number })).toBe(46)
  })

  it("capítulo decimal passa como está (quem arredonda é toChapterCount, na gravação)", () => {
    expect(comixChapterCount({ latestChapter: 102.5 })).toBe(102.5)
  })

  it.each([[0], [-1], [null], [undefined], ["46"], [Number.NaN]])(
    "latestChapter %p não é contagem ⇒ undefined (nunca cai no finalChapter)",
    (latest) => {
      expect(comixChapterCount({ latestChapter: latest, finalChapter: 120 } as { latestChapter: unknown })).toBeUndefined()
    },
  )
})

describe("fetchComixById — o detalhe que a /reading e o 'Atualizar dados' consomem", () => {
  it("devolve o último capítulo postado quando o cadastro declara um final maior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(paginaComFinal(200), { status: 200, headers: { "content-type": "text/html" } })),
    )
    const detalhe = await fetchComixById("003kd")
    expect(detalhe).not.toBeNull()
    expect(detalhe?.chapters).toBe(102.5)
  })
})
