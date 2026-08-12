import { describe, expect, it } from "vitest"
import { classifyHiatus, hiatusFieldsFor, parseHiatusSince, mesesDesde } from "@/lib/external/hiatus-kind"

/**
 * Todos os textos abaixo são REAIS — colhidos da API do MangaUpdates em 2026-08-11 para as 97
 * obras que o catálogo marcava como Hiatus. Inventar o corpus aqui esconderia justamente o que
 * a regra tem de enfrentar: o campo é markdown escrito à mão por voluntários, e a variação de
 * pontuação (`1-40` × `1\~40`, `TBA` × `*TBA*`, `S1:` × `**S1:**`) é o problema, não um detalhe.
 */

describe("classifyHiatus: temporada ABERTA ⇒ interrompida no meio", () => {
  it("reconhece (Ongoing) com range aberto", () => {
    const r = classifyHiatus(
      "69 Chapters + Prologue (Artist Hiatus) as of Jan 19, 2025\n\n S1: 39 Chapters (1-39)  \n S2: 30 Chapters (Ongoing) 40~",
    )
    expect(r.kind).toBe("mid_season")
    expect(r.confidence).toBe("high")
    expect(r.evidence).toContain("motivo declarado")
  })

  it("reconhece range aberto SEM a palavra Ongoing", () => {
    const r = classifyHiatus("42 Chapters (Hiatus)\n\n**S1:** 38 Chapters (1-38)  \n**S2:** 4 Chapters (39~)")
    expect(r).toMatchObject({ kind: "mid_season", confidence: "high" })
  })

  it("reconhece o range aberto com hífen no fim, e em linha de Side Story", () => {
    const r = classifyHiatus(
      "110 Chapters + Prologue (Ongoing)\n\nS1: 40 Chapters (1-40)\nS2: 35 Chapters (41-75)  \nS3: 27 Chapters (76-102)  \nSS: 8 Chapters (Ongoing) 103-",
    )
    expect(r.kind).toBe("mid_season")
  })

  it("reconhece o barra-interrogação que o MU usa quando nem o fim é sabido", () => {
    const r = classifyHiatus(
      "86 Chapters (Ongoing)\n\n**S1:** 40 Chapters (1-40)  \n**S2:** 37 Chapters (41-77)    \n**S3:** 9 Chapters (Ongoing) 78/~",
    )
    expect(r.kind).toBe("mid_season")
  })

  it("aceita (Ongoing) sozinho, sem número de capítulo inicial", () => {
    const r = classifyHiatus("52 Chapters (Ongoing)\n\n**S1:** 45 Chapters (1\\~45)  \n**S2:** 7 Chapters (Ongoing)")
    expect(r.kind).toBe("mid_season")
  })

  it("a temporada aberta vence mesmo quando o motivo vem numa linha solta no fim", () => {
    const r = classifyHiatus(
      "124 Chapters (*Hiatus) since 6/24/2025\n\n**S1:** 77 Chapters (1-77)  \n**Side Story:**  15 Chapters (78-92)  \n**S2:** 32 Chapters (Ongoing) 93\\~\n\n**longterm, due to authors health issues",
    )
    expect(r).toMatchObject({ kind: "mid_season", confidence: "high" })
  })
})

describe("classifyHiatus: próxima temporada PROMETIDA ⇒ pausa entre temporadas", () => {
  it("reconhece TBA", () => {
    const r = classifyHiatus(
      "111 Chapters (Hiatus) since 06.2026\n\nS1: 40 Chapters (01-40)  \nS2: 35 Chapters (41-75)\nS3: 36 Chapters (76-111)  \nS4: TBA\n",
    )
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "high" })
  })

  it("reconhece TBA em itálico e com o rótulo em negrito", () => {
    const r = classifyHiatus(
      "64 Chapters (*Hiatus since 8/2025*)\n\n**S1:** 64 Chapters (1\\~64)  \n**S2:** *TBA*",
    )
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "high" })
  })

  it("reconhece data anunciada no lugar do TBA", () => {
    const r = classifyHiatus("45 Chapters (Hiatus - May 2026)\n\nS1: 45 Chapters (1-45)    \nS2: Sep 2026")
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "high" })
  })

  it("reconhece o anúncio em prosa e com link", () => {
    const r = classifyHiatus(
      "128 Chapters + Prologue (*Hiatus since 11/2024*)\n\n**S1:** 75 Chapters + Review (1\\~75)  \n**S2:** 53 Chapters (76\\~128)  \n**S3:** [Late 2026](https://comic.naver.com/community/u/_aioum/posts/0-aioum-d)",
    )
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "high" })
  })

  it("trata `Side Stories: TBA` como a próxima entrega prometida", () => {
    const r = classifyHiatus(
      "159 Chapters (Hiatus) since 03/12/2026\n\nS1: 42 Chapters (1-42)  \nS2: 37 Chapters (43-79)  \nS3: 43 Chapters (80-122)  \nS4: 37 Chapters (123-159)    \nSide Stories: TBA",
    )
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "high" })
  })
})

describe("classifyHiatus: a distinção mora no range, não na pontuação", () => {
  /**
   * 🔴 A contraprova que justifica o `(?:\)|$)` do `hasOpenRun`. `31~54` e `39~` diferem por um
   * dígito depois do til; sem a âncora, o primeiro casaria como aberto e TODA temporada fechada
   * viraria "interrompida" — 68 das 97 obras trocariam de rótulo sem nada acusar.
   */
  it("range fechado com til NÃO é temporada aberta", () => {
    const r = classifyHiatus(
      "54 Chapters (Hiatus) *since 8/2/26*\n\n**S1:** 30 Chapters (1\\~30)  \n**S2:** 24 Chapters (31~54)  \n**S3:** TBA",
    )
    expect(r.kind).toBe("between_seasons")
  })

  it("data no cabeçalho não promove a última temporada a promessa", () => {
    const r = classifyHiatus(
      "26 Chapters + Prologue + Holiday Special (Hiatus Sep 2025)\n\nS1: 19 Chapters (1-19)  \nS2: 7 Chapters (Ongoing) 20~",
    )
    expect(r.kind).toBe("mid_season")
  })
})

describe("classifyHiatus: o que a regra NÃO afirma", () => {
  it("texto sem quebra por temporada fica indeterminado", () => {
    for (const texto of ["27 Chapters (Hiatus)", "106 Chapters (Hiatus)", "65 Chapters (Hiatus) Since 4/2025"]) {
      expect(classifyHiatus(texto).kind).toBeNull()
    }
  })

  it("texto vazio ou ausente fica indeterminado, sem lançar", () => {
    expect(classifyHiatus(null).kind).toBeNull()
    expect(classifyHiatus(undefined).kind).toBeNull()
    expect(classifyHiatus("   ").kind).toBeNull()
  })

  it("temporada fechada sem próxima anunciada decide com confiança BAIXA", () => {
    const r = classifyHiatus(
      "60 Chapters + Prologue (Hiatus as of 09/09/24)\n\n**S1:** 37 Chapters (01-37)  \n**S2:** 23 Chapters (38-60)  ",
    )
    expect(r).toMatchObject({ kind: "between_seasons", confidence: "low" })
  })

  it("motivo declarado sem estrutura decide com confiança BAIXA", () => {
    expect(classifyHiatus("39 Chapters (Extended Hiatus)")).toMatchObject({
      kind: "mid_season",
      confidence: "low",
    })
  })

  it("o MU às vezes nomeia a pausa de temporada — vale como último recurso", () => {
    expect(classifyHiatus("56 Chapters + 2 Hiatus Specials (Season Hiatus)")).toMatchObject({
      kind: "between_seasons",
      confidence: "low",
    })
  })
})

describe("classifyHiatus: a ÚLTIMA linha de temporada é que responde", () => {
  it("ignora as temporadas fechadas acima da última", () => {
    const r = classifyHiatus(
      "136 Chapters (Hiatus, since 1-22-24)\n\nS1: 51 Chapters (1\\~51)  \nS2: 52 Chapters (52\\~103)  \nS3: 33 (Ongoing) 104\\~ (Hiatus)",
    )
    expect(r.kind).toBe("mid_season")
    expect(r.evidence).toContain("S3")
  })

  /**
   * `Special:` fica fora do regex de propósito: especial é sempre fechado (`11 Chapters
   * (Complete)`) e, vindo depois da última temporada, responderia pela publicação inteira —
   * uma obra parada no meio da S3 seria classificada como pausa entre temporadas.
   */
  it("especial listado depois da última temporada não rouba a resposta", () => {
    const r = classifyHiatus(
      "121 Chapters + Prologue (*Hiatus due to Artist health*)\n\n**S1:** 46 Chapters (1\\~46)  \n**S2:** 50 Chapters (47\\~96)  \n**S3:** 25 Chapters (97\\~)\n\n**Special:** 11 Chapters (Complete)   \n**Special 2:** 2 Chapters (Complete)",
    )
    expect(r).toMatchObject({ kind: "mid_season", confidence: "high" })
    expect(r.evidence).toContain("S3")
  })
})

describe("hiatusFieldsFor: o tipo de hiato só existe dentro do hiato", () => {
  const HIATO = "111 Chapters (Hiatus) since 06.2026\n\nS1: 40 Chapters (01-40)\nS2: TBA"

  it("classifica quando o status é Hiatus", () => {
    expect(hiatusFieldsFor(HIATO, "Hiatus")).toMatchObject({
      hiatus_kind: "between_seasons",
      hiatus_kind_confidence: "high",
    })
  })

  /**
   * 🔴 O caso que obriga a condição a existir, e ele é comum: das 97 obras que o catálogo
   * marcava como Hiatus, 13 já estavam `(Ongoing)` no MU. Sem zerar na volta da publicação,
   * elas exibiriam "pausa entre temporadas" com a obra saindo normalmente.
   */
  it("zera o tipo quando a publicação voltou, mas PRESERVA a nota crua", () => {
    const r = hiatusFieldsFor(HIATO, "Ongoing")
    expect(r.hiatus_kind).toBeNull()
    expect(r.hiatus_kind_confidence).toBeNull()
    expect(r.publication_status_note).toContain("S2: TBA")
  })

  it("mantém as duas pareadas quando o texto não decide (CHECK da migration 183)", () => {
    const r = hiatusFieldsFor("27 Chapters (Hiatus)", "Hiatus")
    expect(r.hiatus_kind).toBeNull()
    expect(r.hiatus_kind_confidence).toBeNull()
  })

  it("texto vazio vira NULL, não string vazia", () => {
    expect(hiatusFieldsFor("   ", "Hiatus").publication_status_note).toBeNull()
    expect(hiatusFieldsFor(undefined, "Hiatus").publication_status_note).toBeNull()
  })
})

describe("parseHiatusSince: a data sai na resolução que o dado sustenta", () => {
  it("nome de mês é inequívoco", () => {
    expect(parseHiatusSince("142 Chapters (Hiatus as of Dec 2024)")).toMatchObject({ year: 2024, month: 12 })
    expect(parseHiatusSince("106 Chapters (*Hiatus since March 2026)")).toMatchObject({ year: 2026, month: 3 })
  })

  it("mês/ano com ano de 4 dígitos é inequívoco", () => {
    expect(parseHiatusSince("111 Chapters (Hiatus) since 06.2026")).toMatchObject({ year: 2026, month: 6 })
    expect(parseHiatusSince("43 Chapters (Hiatus) Since 08/2022")).toMatchObject({ year: 2022, month: 8 })
  })

  /**
   * 🔴 As DUAS convenções convivem no mesmo catálogo — é isto que proíbe chutar. Quando um
   * componente passa de 12 ele só pode ser dia, e o outro vira mês.
   */
  it("desambigua pelo componente que não cabe em 12", () => {
    expect(parseHiatusSince("41 Chapters (On Hiatus) Since 27/8/24")).toMatchObject({ year: 2024, month: 8 })
    expect(parseHiatusSince("103 Chapters (Hiatus) since 11/25/2025")).toMatchObject({ year: 2025, month: 11 })
  })

  it("data genuinamente ambígua devolve só o ANO — nunca um mês chutado", () => {
    const r = parseHiatusSince("159 Chapters (Hiatus) since 03/12/2026")
    expect(r).toMatchObject({ year: 2026, month: null })
    expect(r?.label).toBe("2026")
  })

  /**
   * ⚠️ A faixa de capítulos casa com qualquer regex de data: sem cortar no cabeçalho,
   * "S2: 35 Chapters (41-75)" viraria "parado desde 1975".
   */
  it("ignora as faixas de capítulo abaixo do cabeçalho", () => {
    // A data está no cabeçalho e as faixas embaixo: sem o corte, `41-75` casaria primeiro.
    expect(parseHiatusSince("111 Chapters (Hiatus) since 06.2026\n\nS1: 40 Chapters (01-40)\nS2: 35 Chapters (41-75)"))
      .toMatchObject({ year: 2026, month: 6 })
    // E sem data no cabeçalho o resultado é `null` — nunca um ano pescado de uma faixa.
    expect(parseHiatusSince("111 Chapters (Hiatus)\n\nS1: 40 Chapters (01-40)\nS2: 35 Chapters (41-75)")).toBeNull()
  })

  it("texto sem data devolve null", () => {
    expect(parseHiatusSince("27 Chapters (Hiatus)")).toBeNull()
    expect(parseHiatusSince(null)).toBeNull()
  })

  it("sem mês, a idade ancora no MEIO do ano (erro de ±6 meses, sem viés)", () => {
    const agora = new Date("2026-08-12")
    expect(mesesDesde({ year: 2024, month: null, label: "2024" }, agora)).toBe(26)
    expect(mesesDesde({ year: 2022, month: 8, label: "agosto de 2022" }, agora)).toBe(48)
  })
})
