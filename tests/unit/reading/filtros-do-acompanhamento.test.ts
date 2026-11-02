import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VISIBLE_CRITERION_SLUGS } from "@/lib/criteria/visible"
import { INTEREST_NONE } from "@/lib/interest-sentinels"
import {
  READING_ATTRIBUTE_FIELDS,
  READING_NOTE_FIELDS,
  READING_SCORE_FIELDS,
  activeReadingFilterCount,
  clearedReadingFilterParams,
  countReadingWorks,
  matchesReadingFilters,
  parseReadingFilters,
  passesReadingAdultFilter,
  readingEditionFor,
  readingFilterChips,
  readingScoreHistogram,
  readingScoreValue,
} from "@/lib/reading/reading-filters"
import type { ReadingFilterFields, ReadingFilters } from "@/lib/reading/reading-filters"

const obra = (over: Partial<ReadingFilterFields> = {}): ReadingFilterFields => ({
  isAdult: false,
  isMixed: false,
  synopsisQuality: null,
  readEdition: null,
  defaultEdition: null,
  expectedScore: null,
  alignmentScore: null,
  criterionScores: {},
  byEdition: null,
  ...over,
})

const mixed = (over: Partial<ReadingFilterFields> = {}) =>
  obra({
    isMixed: true,
    defaultEdition: "r18",
    criterionScores: { adult_content: 9.5 }, // a nota MISTURADA: nunca pode ser lida
    byEdition: {
      normal: { expectedScore: 8, adultContent: 6 },
      r18: { expectedScore: 7, adultContent: 9.5 },
    },
    ...over,
  })

const filtros = (over: Partial<ReadingFilters> = {}): ReadingFilters => ({
  adult: "all",
  interest: new Set(),
  ranges: {},
  ...over,
})

const campo = (key: string) => READING_SCORE_FIELDS.find((f) => f.key === key)!

describe("18+ na lista de leitura: a obra R19 segue a versão que a pessoa lê", () => {
  it("lida na R18 sai de Ocultar e entra em Só 18+", () => {
    const w = mixed({ readEdition: "r18" })
    expect(passesReadingAdultFilter(w, "hide")).toBe(false)
    expect(passesReadingAdultFilter(w, "only")).toBe(true)
  })

  it("lida na normal fica em Ocultar e sai de Só 18+", () => {
    const w = mixed({ readEdition: "normal" })
    expect(passesReadingAdultFilter(w, "hide")).toBe(true)
    expect(passesReadingAdultFilter(w, "only")).toBe(false)
  })

  it("sem versão marcada fica nos dois lados: não dá para afirmar nenhum", () => {
    const w = mixed()
    expect(passesReadingAdultFilter(w, "hide")).toBe(true)
    expect(passesReadingAdultFilter(w, "only")).toBe(true)
  })

  it("obra sem versão segue o gate da obra, e read_edition solta não a muda de lado", () => {
    expect(passesReadingAdultFilter(obra({ isAdult: true }), "hide")).toBe(false)
    expect(passesReadingAdultFilter(obra({ isAdult: true }), "only")).toBe(true)
    expect(passesReadingAdultFilter(obra(), "hide")).toBe(true)
    expect(passesReadingAdultFilter(obra(), "only")).toBe(false)
    expect(passesReadingAdultFilter(obra({ readEdition: "r18" }), "hide")).toBe(true)
  })

  it("Tudo não corta ninguém", () => {
    for (const w of [mixed({ readEdition: "r18" }), obra({ isAdult: true }), obra()]) {
      expect(passesReadingAdultFilter(w, "all")).toBe(true)
    }
  })

  it("reproduz a lista medida em 01/11/2026: 52 obras, 32 em Ocultar e 21 em Só 18+", () => {
    const lista = [
      ...Array.from({ length: 31 }, () => obra()),
      ...Array.from({ length: 12 }, () => obra({ isAdult: true })),
      ...Array.from({ length: 8 }, () => mixed({ readEdition: "r18" })),
      mixed(),
    ]
    expect(lista).toHaveLength(52)
    expect(countReadingWorks(lista, filtros({ adult: "hide" }))).toBe(32)
    expect(countReadingWorks(lista, filtros({ adult: "only" }))).toBe(21)
    expect(countReadingWorks(lista, filtros())).toBe(52)
  })
})

describe("a nota de uma edição nunca vem da outra", () => {
  it("a edição em contexto segue o filtro; sem filtro, a versão lida; sem versão lida, o padrão", () => {
    expect(readingEditionFor(mixed({ readEdition: "r18" }), "hide")).toBe("normal")
    expect(readingEditionFor(mixed({ readEdition: "normal" }), "only")).toBe("r18")
    expect(readingEditionFor(mixed({ readEdition: "normal" }), "all")).toBe("normal")
    expect(readingEditionFor(mixed({ defaultEdition: "normal" }), "all")).toBe("normal")
    expect(readingEditionFor(obra(), "all")).toBeNull()
  })

  it("conteúdo adulto de uma mixed é o da edição, nunca a nota misturada", () => {
    const adulto = campo("adult_content")
    expect(readingScoreValue(mixed({ readEdition: "normal" }), adulto, "all")).toBe(6)
    expect(readingScoreValue(mixed({ readEdition: "r18" }), adulto, "all")).toBe(9.5)
  })

  it("edição sem nota é AUSÊNCIA: o filtro corta, em vez de herdar a outra", () => {
    const w = mixed({
      readEdition: "normal",
      byEdition: { normal: { expectedScore: null, adultContent: null }, r18: { expectedScore: 7, adultContent: 9.5 } },
    })
    expect(readingScoreValue(w, campo("adult_content"), "all")).toBeNull()
    expect(readingScoreValue(w, campo("expected"), "all")).toBeNull()
    expect(matchesReadingFilters(w, filtros({ ranges: { adult_content: { min: 5 } } }))).toBe(false)
  })

  it("a Nota Prevista de uma mixed é a da edição, não a coluna da edição padrão", () => {
    const w = mixed({ readEdition: "normal", expectedScore: 7 })
    expect(readingScoreValue(w, campo("expected"), "all")).toBe(8)
  })

  it("o limiar da Prevista olha o número da tela", () => {
    const w = obra({ expectedScore: 7.96 })
    expect(matchesReadingFilters(w, filtros({ ranges: { expected: { min: 8 } } }))).toBe(true)
  })
})

describe("obra sem nota", () => {
  it("sai da lista num filtro de atributo, nos dois sentidos", () => {
    const w = obra({ criterionScores: { romance: 8 } })
    expect(matchesReadingFilters(w, filtros({ ranges: { angst: { min: 5 } } }))).toBe(false)
    expect(matchesReadingFilters(w, filtros({ ranges: { angst: { max: 5 } } }))).toBe(false)
  })

  it("continua na lista no filtro de Veredito, como no /ranking", () => {
    expect(matchesReadingFilters(obra(), filtros({ ranges: { align: { min: 80 } } }))).toBe(true)
    expect(matchesReadingFilters(obra({ alignmentScore: 50 }), filtros({ ranges: { align: { min: 80 } } }))).toBe(false)
  })

  it("Ø casa só quem não marcou interesse", () => {
    const f = filtros({ interest: new Set([INTEREST_NONE]) })
    expect(matchesReadingFilters(obra(), f)).toBe(true)
    expect(matchesReadingFilters(obra({ synopsisQuality: "♥♥" }), f)).toBe(false)
  })
})

describe("as contagens são de quantas obras SOBRARIAM", () => {
  const lista = [
    obra({ synopsisQuality: "♥♥♥♥", criterionScores: { tragedy: 2 } }),
    obra({ synopsisQuality: "♥♥♥♥", isAdult: true, criterionScores: { tragedy: 2 } }),
    obra({ synopsisQuality: "♥♥", criterionScores: { tragedy: 6 } }),
  ]

  it("a opção de uma dimensão respeita os filtros das outras", () => {
    const base = filtros({ ranges: { tragedy: { max: 3 } } })
    expect(countReadingWorks(lista, { ...base, adult: "hide" })).toBe(1)
    expect(countReadingWorks(lista, { ...base, adult: "only" })).toBe(1)
    expect(countReadingWorks(lista, { ...base, interest: new Set(["♥♥"]) })).toBe(0)
  })

  it("o histograma ignora o limiar do próprio campo e marca o que está dentro", () => {
    const f = filtros({ adult: "hide", ranges: { tragedy: { max: 3 } } })
    const bins = readingScoreHistogram(lista, f, campo("tragedy"))
    expect(bins).toHaveLength(21)
    expect(bins.find((b) => b.value === 2)).toMatchObject({ count: 1, inRange: true })
    expect(bins.find((b) => b.value === 6)).toMatchObject({ count: 1, inRange: false })
  })
})

describe("a URL fala a língua do /ranking", () => {
  const de = (q: string) => parseReadingFilters(new URLSearchParams(q))

  it("lê limiar em pontos, ♥ e 18+", () => {
    const f = de("adult=hide&synopsis_q=%E2%99%A5%E2%99%A5%E2%99%A5%E2%99%A5,none&max_tragedy=3&min_expected=8")
    expect(f.adult).toBe("hide")
    expect([...f.interest]).toEqual(["♥♥♥♥", INTEREST_NONE])
    expect(f.ranges).toEqual({ tragedy: { max: 3 }, expected: { min: 8 } })
    expect(activeReadingFilterCount(f)).toBe(4)
  })

  it("ignora o que não é filtro: limiar na ponta da escala, adult inválido, ♥ inventado", () => {
    const f = de("adult=x&synopsis_q=lixo,unknown&min_romance=0&max_romance=10&max_align=100&min_nada=4")
    expect(f).toEqual({ adult: "all", interest: new Set(), ranges: {} })
    expect(activeReadingFilterCount(f)).toBe(0)
  })

  it("os parâmetros de nota são os que o /ranking lê", () => {
    const pagina = readFileSync(join(process.cwd(), "app/ranking/page.tsx"), "utf-8")
    for (const f of READING_NOTE_FIELDS) {
      expect(pagina).toContain(`"${f.minKey}"`)
      expect(pagina).toContain(`"${f.maxKey}"`)
    }
    expect(pagina).toContain('"synopsis_q"')
  })

  it("limpar zera todos os parâmetros que o painel grava", () => {
    const limpos = clearedReadingFilterParams()
    for (const f of READING_SCORE_FIELDS) {
      expect(limpos).toHaveProperty(f.minKey, null)
      expect(limpos).toHaveProperty(f.maxKey, null)
    }
    expect(limpos).toHaveProperty("adult", null)
    expect(limpos).toHaveProperty("synopsis_q", null)
  })
})

describe("o painel cobre todo critério visível", () => {
  it("critério novo no Supabase entra sozinho, e com URL própria", () => {
    expect(READING_ATTRIBUTE_FIELDS.map((f) => f.key)).toEqual([...VISIBLE_CRITERION_SLUGS])
    for (const f of READING_ATTRIBUTE_FIELDS) {
      expect(f.minKey).toBe(`min_${f.key}`)
      expect(f.maxKey).toBe(`max_${f.key}`)
    }
  })

  it("todo campo tem nome e emoji: sem isso o chip imprimiria o slug cru", () => {
    for (const f of READING_SCORE_FIELDS) {
      expect(f.label).not.toBe(f.key)
      expect(f.emoji).not.toBe("")
    }
  })
})

describe("cada chip sabe como se desfazer", () => {
  it("tirar um ♥ mantém os outros", () => {
    const chips = readingFilterChips(filtros({ interest: new Set(["♥♥♥♥", "♥♥♥"]) }))
    const quatro = chips.find((c) => c.label === "♥♥♥♥")!
    expect(quatro.clear).toEqual({ synopsis_q: "♥♥♥" })
  })

  it("tirar o último ♥ apaga o parâmetro, e o limiar leva as duas pontas", () => {
    const f = filtros({ interest: new Set(["♥"]), ranges: { drama: { min: 4, max: 6 } } })
    const [heart, faixa] = readingFilterChips(f)
    expect(heart!.clear).toEqual({ synopsis_q: null })
    expect(faixa!.label).toBe("Drama 4–6")
    expect(faixa!.clear).toEqual({ min_drama: null, max_drama: null })
  })
})
