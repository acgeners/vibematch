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

import {
  IMPLAUSIBLE_MIN_GAP,
  isImplausibleChapter,
  pickTotalChapters,
  toChapterCount,
} from "@/lib/external/chapter-total"
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

// A régua (decidida em 2026-11-09): o número é o ÚLTIMO CAPÍTULO DISPONÍVEL PARA LER. Comix
// primeiro; o Mangago só sem ele; as demais fontes só sem nenhum dos dois.
describe("pickTotalChapters — a régua", () => {
  it("o Comix vence mesmo com o Mangago à FRENTE — um capítulo-aviso do Mangago não vira capítulo novo", () => {
    // Obra real em andamento: MU 62, ComicK 63, Comix 69, Mangago 70. A régua antiga (o MAIOR
    // dos dois) dava 70.
    const r = pickTotalChapters(fontes({ mangaupdates: 62, comick: 63, comix: 69, mangago: 70 }), "Ongoing")
    expect(r).toEqual({ value: 69, source: "comix", decidedByRule: true })
  })

  it("obra em andamento: não BAIXA para o MangaUpdates atrasado", () => {
    // Obra real: banco 16, MU 13, Comix 31 — o merge antigo propunha 13.
    expect(pickTotalChapters(fontes({ mangaupdates: 13, comix: 31 }), "Ongoing").value).toBe(31)
  })

  it("o Comix vence o MangaUpdates à FRENTE — é o que a /reading grava", () => {
    // Obra real: MU 74, os três de scan em 68.
    const r = pickTotalChapters(fontes({ mangaupdates: 74, comick: 68, comix: 68, mangago: 68 }), "Ongoing")
    expect(r.value).toBe(68)
  })

  it("sem Comix: o Mangago, ainda decidido pela régua", () => {
    expect(pickTotalChapters(fontes({ mangaupdates: 30, mangago: 25 }), "Ongoing")).toEqual({
      value: 25,
      source: "mangago",
      decidedByRule: true,
    })
  })

  it("sem Comix nem Mangago: o maior entre as demais, e a divergência segue sendo decisão humana", () => {
    expect(pickTotalChapters(fontes({ mangaupdates: 25, comick: 30 }), "Ongoing")).toEqual({
      value: 30,
      source: "comick",
      decidedByRule: false,
    })
  })

  it.each(["Hiatus", "Unknown", "Completed", "Cancelled", null, undefined])(
    "status %s não muda a escolha quando o Comix responde",
    (status) => {
      expect(pickTotalChapters(fontes({ mangaupdates: 13, comix: 31 }), status).value).toBe(31)
    },
  )

  it("obra CONCLUÍDA com tradução atrasada: o disponível, não o total do original", () => {
    // Obra real (medido em 2026-11-09): concluída, 29 no banco, 22 no Comix e no Mangago, tudo
    // lido. Com o total do original a /reading mostrava 7 capítulos a ler que não existem.
    expect(pickTotalChapters(fontes({ mangaupdates: 29, comix: 22, mangago: 22 }), "Completed")).toEqual({
      value: 22,
      source: "comix",
      decidedByRule: true,
    })
  })

  it("contraprova do preço aceito: tradução abandonada fica com o tamanho traduzido", () => {
    // Obra real: MU 94, Comix 56, Mangago 35, ComicK 19. Era 94 (MangaUpdates-primeiro).
    expect(pickTotalChapters(fontes({ mangaupdates: 94, comick: 19, comix: 56, mangago: 35 }), "Completed").value).toBe(56)
  })

  it("sem Comix nem Mangago, obra terminada segue a ordem das fontes (MU na frente)", () => {
    expect(pickTotalChapters(fontes({ mangaupdates: 40, comick: 55 }), "Completed").value).toBe(40)
    expect(pickTotalChapters(fontes({ mangaupdates: 40, comick: 55 }), "Cancelled").value).toBe(40)
  })
})

describe("pickTotalChapters — a conferência de número corrompido", () => {
  it("o Comix corrompido é descartado e o Mangago assume", () => {
    // Obra real: Comix 815 numa obra de 81.
    expect(pickTotalChapters(fontes({ mangaupdates: 81, comix: 815, mangago: 81 }), "Completed")).toEqual({
      value: 81,
      source: "mangago",
      decidedByRule: true,
    })
  })

  it("o total já gravado serve de referência quando a /reading só tem o Comix", () => {
    const r = pickTotalChapters(fontes({ comix: 815 }), null, { current: 81 })
    expect(r).toEqual({ value: undefined, decidedByRule: false })
  })

  it("fonte BAIXA nunca derruba quem está acima: tradução atrasada e slug errado são o caso comum", () => {
    // Obra real (medido em 2026-11-09): Comix 41, Mangago 1 — o 41 é o certo.
    expect(pickTotalChapters(fontes({ comix: 41, mangago: 1 }), "Ongoing").value).toBe(41)
    // Obra longa com a outra fonte bem atrás: razão alta, mas abaixo da folga absoluta.
    expect(pickTotalChapters(fontes({ comix: 90, mangadex: 10 }), "Ongoing").value).toBe(90)
  })

  it("as duas condições juntas — razão E folga", () => {
    expect(isImplausibleChapter(815, 81)).toBe(true)
    expect(isImplausibleChapter(41, 1)).toBe(false) // razão alta, folga pequena
    expect(isImplausibleChapter(250, 120)).toBe(false) // folga grande, razão pequena
    expect(isImplausibleChapter(500, null)).toBe(false) // sem referência, nada a conferir
    expect(isImplausibleChapter(IMPLAUSIBLE_MIN_GAP * 2, IMPLAUSIBLE_MIN_GAP / 10)).toBe(true)
  })

  it("o total gravado é só referência — nunca vira o valor escolhido", () => {
    expect(pickTotalChapters(fontes({ comix: 22 }), "Completed", { current: 29 }).value).toBe(22)
  })
})

describe("pickTotalChapters — contagem", () => {

  it("capítulo decimal vira o inteiro de cima e zero não é contagem", () => {
    expect(toChapterCount(29.1)).toBe(30)
    expect(toChapterCount(63.5)).toBe(64)
    expect(toChapterCount(30)).toBe(30)
    expect(toChapterCount(0)).toBeUndefined()
    expect(toChapterCount(null)).toBeUndefined()
    expect(pickTotalChapters(fontes({ kitsu: 0, mangaupdates: null }), "Ongoing").value).toBeUndefined()
  })

  it("as fontes autorizadas são as mesmas do agregador da /reading, e a ORDEM é a preferência", () => {
    // O agregador monta o registro sobre esta lista (um Record — o `tsc` reprova fonte sem
    // checadora). A ordem decide quem vence: trocá-la põe o Mangago (e o capítulo-aviso dele)
    // na frente do Comix sem ninguém decidir nada.
    expect([...CHAPTER_SOURCE_IDS]).toEqual(["comix", "mangago"])
  })
})

describe("o merge do 'Atualizar dados' usa a régua", () => {
  const candidato: MergedCandidate = {
    title: "Obra Teste",
    sources: ["mangaupdates", "comix", "mangago"],
    trustedSources: ["mangaupdates", "comix", "mangago"],
    muId: 123,
    comixHid: "abc12",
    mangagoSlug: "obra_teste",
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

  it("obra em andamento: o total é o da /reading (o Comix) e a divergência com o MU não vira conflito", async () => {
    fontesResponde("Ongoing", { mu: 62, comix: 69, mangago: 70 })
    const out = await fetchMultiSourceDetails(candidato)

    expect(out.data.totalChapters).toBe(69)
    // Sem isto, o "Atualizar" do Assinante (que PULA campo em conflito) nunca subia o total.
    expect(out.conflicts.some((c) => c.field === "totalChapters")).toBe(false)
    // O valor do MU continua visível como alternativa no passo de conflitos do curador.
    expect(out.data.fieldProvenance?.totalChapters?.map((p) => p.value)).toEqual(expect.arrayContaining([62, 69, 70]))
  })

  it("obra concluída também: o disponível, sem conflito — a /reading grava o mesmo número", async () => {
    // Antes era o MangaUpdates (94) com conflito; aí a /reading, que agora também checa obra
    // concluída, gravaria 56 e o "Atualizar dados" seguinte proporia voltar a 94.
    fontesResponde("Completed", { mu: 94, comix: 56, mangago: 35 })
    const out = await fetchMultiSourceDetails(candidato)

    expect(out.data.totalChapters).toBe(56)
    expect(out.conflicts.some((c) => c.field === "totalChapters")).toBe(false)
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
