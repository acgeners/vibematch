import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { formatMangaUpdatesComment, muMarkdownToText } from "@/lib/external/mangaupdates-comments"
import { fetchMangaUpdatesReviews, MangaUpdatesUnavailableError } from "@/lib/external/mangaupdates"

// Casos REAIS: o registro cru de `POST /v1/series/{id}/comments/search` ao lado do texto que a
// raspagem da página GRAVOU em `work_reviews` (backup da nuvem de 2026-11-01). A persistência
// deduplica por texto exato, então "o formato novo reproduz o antigo" é contrato, não estética:
// texto diferente entraria como uma 2ª linha do mesmo comentário.
const FIXTURE: Array<{
  caso: string
  subject: string | null
  content: string
  rating: number | null
  gravado: string
}> = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/mangaupdates/comentarios-api-vs-gravado.json"), "utf-8"),
)

describe("formatMangaUpdatesComment — reproduz o texto que a raspagem gravava", () => {
  it("a fixture cobre os recursos de Markdown que a página renderizava", () => {
    expect(FIXTURE.map((c) => c.caso)).toEqual(
      expect.arrayContaining([
        "enfase *x*",
        "negrito literal (flanking)",
        "asteriscos literais (s***)",
        "lista numerada",
        "lista com hifen",
        "spoiler de linha >!",
        "spoiler de linha com hifen",
        "citacao >",
        "emoji (corte em 900 por UTF-16)",
      ]),
    )
  })

  it.each(FIXTURE)("$caso", (c) => {
    const texto = formatMangaUpdatesComment({ subject: c.subject, content: c.content, rating: c.rating })
    // O corte de 900 é do conector (mesma unidade UTF-16 do código antigo).
    expect(texto?.slice(0, 900)).toBe(c.gravado)
  })
})

describe("muMarkdownToText", () => {
  it("tira a marcação que a página não exibia", () => {
    expect(muMarkdownToText("feeling *things* for her and **really** __bold__")).toBe(
      "feeling things for her and really bold",
    )
    expect(muMarkdownToText("# Título\nTexto")).toBe("Título Texto")
    expect(muMarkdownToText("Edit.\nnova parte\n\n-----------------------------\nOriginal comment.")).toBe(
      "Edit. nova parte Original comment.",
    )
    expect(muMarkdownToText("veja [o capítulo](https://x.y/z) e ![capa](https://x.y/c.png)")).toBe(
      "veja o capítulo e capa",
    )
    expect(muMarkdownToText("uso `código` aqui")).toBe("uso código aqui")
  })

  it("segue o CommonMark: delimitador que não flanqueia fica LITERAL", () => {
    // Os dois vieram do texto raspado: a página manteve os asteriscos.
    expect(muMarkdownToText("**Rating:**10 (Masterpiece)")).toBe("**Rating:**10 (Masterpiece)")
    expect(muMarkdownToText("his personality is s***, then he's s***.")).toBe("his personality is s***, then he's s***.")
    expect(muMarkdownToText("5 * 3 = 15")).toBe("5 * 3 = 15")
    // Sublinhado dentro de palavra não é ênfase.
    expect(muMarkdownToText("snake_case_name")).toBe("snake_case_name")
  })

  it("abre o spoiler, com e sem fechamento", () => {
    expect(muMarkdownToText("o final >!ela morre!< e pronto")).toBe("o final ela morre e pronto")
    expect(muMarkdownToText("antes\n>! o spoiler da linha\ndepois")).toBe("antes o spoiler da linha depois")
    // Dentro do spoiler de linha, "- " é texto, não lista.
    expect(muMarkdownToText("The bad:\n\n>! - It started dragging")).toBe("The bad: - It started dragging")
  })

  it("respeita escape e decodifica entidade", () => {
    expect(muMarkdownToText("\\*não é ênfase\\*")).toBe("*não é ênfase*")
    expect(muMarkdownToText("Tom &amp; Jerry &#39;x&#39;")).toBe("Tom & Jerry 'x'")
    // "<3" não é tag: tem de sobreviver.
    expect(muMarkdownToText("amei <3 demais")).toBe("amei <3 demais")
  })
})

describe("formatMangaUpdatesComment — cabeçalho", () => {
  it("nota com uma casa decimal, como a página imprimia", () => {
    expect(formatMangaUpdatesComment({ subject: "Ótimo", content: "texto", rating: 10 })).toBe(
      "Título do comentário: Ótimo\nNota do usuário: 10.0/10\ntexto",
    )
    expect(formatMangaUpdatesComment({ subject: "x", content: "y", rating: 7.5 })).toContain("Nota do usuário: 7.5/10")
  })

  it("sem nota ou sem título, a linha some; sem corpo, o comentário some", () => {
    expect(formatMangaUpdatesComment({ subject: "x", content: "y", rating: null })).toBe("Título do comentário: x\ny")
    expect(formatMangaUpdatesComment({ subject: "", content: "y", rating: 8 })).toBe("Nota do usuário: 8.0/10\ny")
    expect(formatMangaUpdatesComment({ subject: "x", content: "  \n ", rating: 8 })).toBeNull()
    expect(formatMangaUpdatesComment({ subject: "x", content: null, rating: 8 })).toBeNull()
  })
})

describe("fetchMangaUpdatesReviews — pela API oficial", () => {
  afterEach(() => vi.unstubAllGlobals())

  const record = (i: number, content = `comentário ${i}`) => ({
    record: { id: i, subject: `t${i}`, content },
    metadata: { author_series_rating: 8 },
  })
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it("uma chamada só, ao endpoint de comentários da API — nunca ao site", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ results: [record(1)] }))
    vi.stubGlobal("fetch", fetchMock)

    await fetchMangaUpdatesReviews(15180124327)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.mangaupdates.com/v1/series/15180124327/comments/search")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ method: "useful", perpage: 50, page: 1 })
    // Não se passar por navegador: foi o UA fixo de um Chrome antigo que o site passou a recusar.
    const ua = (init.headers as Record<string, string>)["User-Agent"]
    expect(ua).toBeTruthy()
    expect(ua).not.toMatch(/Mozilla|Chrome|Safari|Firefox/)
  })

  it("descarta comentário sem corpo, guarda até 30 e corta cada um em 900", async () => {
    const longo = "a".repeat(2000)
    const results = [record(0, "   "), ...Array.from({ length: 40 }, (_, i) => record(i + 1, i === 0 ? longo : undefined))]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ results })))

    const comments = await fetchMangaUpdatesReviews(1)

    expect(comments).toHaveLength(30)
    expect(comments[0].startsWith("Título do comentário: t1\n")).toBe(true)
    expect(comments[0]).toHaveLength(900)
  })

  it("zero comentários é resultado legítimo: []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ total_hits: 0, results: [] })))
    await expect(fetchMangaUpdatesReviews(1)).resolves.toEqual([])
  })

  it("falha de coleta REJEITA (vira failedSources), em vez de passar por zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>429</html>", { status: 429 })))
    await expect(fetchMangaUpdatesReviews(1)).rejects.toMatchObject({ name: "MangaUpdatesUnavailableError", reason: "http" })

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    await expect(fetchMangaUpdatesReviews(1)).rejects.toMatchObject({ reason: "network" })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>ok</html>", { status: 200 })))
    await expect(fetchMangaUpdatesReviews(1)).rejects.toMatchObject({ reason: "invalid_response" })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ erro: "x" })))
    await expect(fetchMangaUpdatesReviews(1)).rejects.toBeInstanceOf(MangaUpdatesUnavailableError)
  })
})
