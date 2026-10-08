// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O total de capítulos tem DUAS rotas que o gravam — a checagem da `/reading` e o
// "Atualizar dados" da página da obra — e até 2026-10-08 cada uma tinha a sua régua. O
// "Atualizar dados" pegava o PRIMEIRO valor na ordem das fontes (MangaUpdates na frente), que
// fica atrás em obra ainda saindo: o total não subia e, quando a `/reading` já o tinha subido,
// era proposto BAIXAR de volta. Os números dos casos abaixo são de obras reais, medidas no dia.

vi.mock("@/lib/external/mangaupdates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/mangaupdates")>()),
  fetchMangaUpdatesById: vi.fn(),
}))
vi.mock("@/lib/external/comix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comix")>()),
  fetchComixById: vi.fn(),
}))
vi.mock("@/lib/external/mangago", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/mangago")>()),
  fetchMangagoById: vi.fn(),
}))

import { pickTotalChapters, toChapterCount } from "@/lib/external/chapter-total"
import { CHAPTER_SOURCE_IDS } from "@/lib/external/chapter-sources/types"
import { fetchMultiSourceDetails } from "@/lib/external/index"
import { fetchMangaUpdatesById } from "@/lib/external/mangaupdates"
import { fetchComixById } from "@/lib/external/comix"
import { fetchMangagoById, parseMangagoDetailHtml } from "@/lib/external/mangago"
import type { ExternalSourceId, MergedCandidate } from "@/lib/external/types"

const mu = vi.mocked(fetchMangaUpdatesById)
const comix = vi.mocked(fetchComixById)
const mangago = vi.mocked(fetchMangagoById)

type Fonte = { source: ExternalSourceId; chapters?: number | null }
const fontes = (valores: Partial<Record<ExternalSourceId, number | null>>): Fonte[] =>
  (Object.entries(valores) as Array<[ExternalSourceId, number | null]>).map(([source, chapters]) => ({ source, chapters }))

describe("pickTotalChapters — a régua", () => {
  it("obra em andamento: o MAIOR entre Comix e Mangago, mesmo com o MangaUpdates atrás", () => {
    // That's Not What My Will Said: banco 62, e o merge antigo devolvia 62 (o MU).
    const r = pickTotalChapters(fontes({ mangaupdates: 62, comick: 63, comix: 69, mangago: 70 }), "Ongoing")
    expect(r).toEqual({ value: 70, decidedByRule: true })
  })

  it("obra em andamento: não BAIXA para o MangaUpdates atrasado", () => {
    // Dokkaebi: banco 16, MU 13, Comix 31 — o merge antigo propunha 13.
    expect(pickTotalChapters(fontes({ mangaupdates: 13, comix: 31 }), "Ongoing").value).toBe(31)
  })

  it("obra em andamento: Comix/Mangago vencem mesmo quando o MU está à FRENTE — é o que a /reading grava", () => {
    // Monster Princess of the Snowy Mountain: MU 74, os três de scan em 68. Com "o maior de
    // todos" o merge diria 74 e a /reading voltaria a 68 na checagem seguinte.
    const r = pickTotalChapters(fontes({ mangaupdates: 74, comick: 68, comix: 68, mangago: 68 }), "Ongoing")
    expect(r.value).toBe(68)
  })

  it("sem Comix nem Mangago: o maior entre as demais, e a divergência segue sendo decisão humana", () => {
    expect(pickTotalChapters(fontes({ mangaupdates: 25, comick: 30 }), "Ongoing")).toEqual({
      value: 30,
      decidedByRule: false,
    })
  })

  it.each(["Hiatus", "Unknown", null, undefined])("status %s conta como ainda saindo", (status) => {
    expect(pickTotalChapters(fontes({ mangaupdates: 13, comix: 31 }), status).value).toBe(31)
  })

  it("obra CONCLUÍDA: segue no MangaUpdates-primeiro — scan incompleta não derruba o total", () => {
    // Stained Scarlet: MU 94 (o banco), Comix 56, Mangago 35, ComicK 19.
    const r = pickTotalChapters(fontes({ mangaupdates: 94, comick: 19, comix: 56, mangago: 35 }), "Completed")
    expect(r).toEqual({ value: 94, decidedByRule: false })
  })

  it("obra CONCLUÍDA: número corrompido numa fonte não vence pelo tamanho", () => {
    // The Princess's Bedroom Doll: Comix 815 numa obra de 81.
    expect(pickTotalChapters(fontes({ mangaupdates: 81, comix: 815, mangago: 81 }), "Completed").value).toBe(81)
  })

  it("obra CANCELADA conta como terminada", () => {
    expect(pickTotalChapters(fontes({ mangaupdates: 40, comix: 55 }), "Cancelled").value).toBe(40)
  })

  it("capítulo decimal vira o inteiro de cima e zero não é contagem", () => {
    expect(toChapterCount(29.1)).toBe(30)
    expect(toChapterCount(63.5)).toBe(64)
    expect(toChapterCount(30)).toBe(30)
    expect(toChapterCount(0)).toBeUndefined()
    expect(toChapterCount(null)).toBeUndefined()
    expect(pickTotalChapters(fontes({ kitsu: 0, mangaupdates: null }), "Ongoing").value).toBeUndefined()
  })

  it("as fontes autorizadas são as mesmas do agregador da /reading", () => {
    // O agregador monta o registro sobre esta lista (um Record — o `tsc` reprova fonte sem
    // checadora); aqui fica escrito que a lista É a das duas fontes que ele consulta hoje.
    expect([...CHAPTER_SOURCE_IDS].sort()).toEqual(["comix", "mangago"])
  })
})

describe("o merge do 'Atualizar dados' usa a régua", () => {
  const candidato: MergedCandidate = {
    title: "That's Not What My Will Said",
    sources: ["mangaupdates", "comix", "mangago"],
    trustedSources: ["mangaupdates", "comix", "mangago"],
    muId: 123,
    comixHid: "abc12",
    mangagoSlug: "thats_not_what_my_will_said",
  }

  beforeEach(() => {
    vi.resetAllMocks()
    // Nada sai para a rede além das três fontes mockadas.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Just a moment...", { status: 403 })))
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function fontesResponde(status: string, valores: { mu: number; comix: number; mangago: number }) {
    mu.mockResolvedValue({ title: candidato.title, publicationStatus: status, chapters: valores.mu } as never)
    comix.mockResolvedValue({ hid: "abc12", title: candidato.title, alternativeTitles: [], tags: [], chapters: valores.comix } as never)
    mangago.mockResolvedValue({ title: candidato.title, chapters: valores.mangago } as never)
  }

  it("obra em andamento: o total é o da /reading e a divergência com o MU não vira conflito", async () => {
    fontesResponde("Ongoing", { mu: 62, comix: 69, mangago: 70 })
    const out = await fetchMultiSourceDetails(candidato)

    expect(out.data.totalChapters).toBe(70)
    // Sem isto, o "Atualizar" do Assinante (que PULA campo em conflito) nunca subia o total.
    expect(out.conflicts.some((c) => c.field === "totalChapters")).toBe(false)
    // O valor do MU continua visível como alternativa no passo de conflitos do curador.
    expect(out.data.fieldProvenance?.totalChapters?.map((p) => p.value)).toEqual(expect.arrayContaining([62, 69, 70]))
  })

  it("contraprova: obra concluída segue no MU, e a divergência continua sendo conflito", async () => {
    fontesResponde("Completed", { mu: 94, comix: 56, mangago: 35 })
    const out = await fetchMultiSourceDetails(candidato)

    expect(out.data.totalChapters).toBe(94)
    expect(out.conflicts.some((c) => c.field === "totalChapters")).toBe(true)
  })
})

describe("o Mangago entrega o capítulo pela página do detalhe", () => {
  it("lê o maior capítulo da tabela, sem requisição a mais", () => {
    const html = `<meta property="og:title" content="Obra Teste"><div class="manga_summary">Uma sinopse.</div>
      <table id="chapter_table"><tr><td><b>Ch.70 : Fim</b></td><td>Oct 05, 2026</td></tr><tr><td><b>Ch.69.5</b></td><td>Sep 28, 2026</td></tr></table>`
    expect(parseMangagoDetailHtml(html)?.chapters).toBe(70)
  })

  it("sem tabela, sem capítulo — nunca um zero", () => {
    expect(parseMangagoDetailHtml(`<meta property="og:title" content="Obra Teste">`)?.chapters).toBeUndefined()
  })
})

describe("a /reading grava o total pelo mesmo arredondamento", () => {
  it("o valor gravado em total_chapters sai de toChapterCount", () => {
    const src = readFileSync(join(process.cwd(), "server/actions/reading.ts"), "utf8")
    const escrita = src.match(/\.update\(\{\s*total_chapters:\s*([A-Za-z_$][\w$]*)\s*\}\)/)
    expect(escrita, "a escrita de total_chapters na /reading sumiu ou mudou de forma").not.toBeNull()
    const variavel = escrita![1]
    expect(src).toMatch(new RegExp(`const ${variavel}\\s*=\\s*toChapterCount\\(`))
  })
})
