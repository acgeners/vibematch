import { describe, expect, it } from "vitest"

import {
  ART_PISO_REVIEWS,
  ART_PREDOMINANCIA_MINIMA,
  ART_SIGNAL_VERSION,
  normalizarArte,
} from "@/lib/ai-evaluation/art-signal"

/**
 * O validador do art4 só REBAIXA. Cada regra (A–E do contrato) tem aqui um caso que a dispara e um
 * vizinho que fica de pé — sem o vizinho, uma regra frouxa demais (rebaixando tudo) passaria verde.
 */

const REVIEWS = [
  { id: "R1", text: "The art is absolutely gorgeous, every panel looks like a painting." },
  { id: "R2", text: "Beautiful art and the colors are stunning throughout the story." },
  { id: "R3", text: "Gorgeous artwork, the character designs are lovely and detailed." },
  { id: "R4", text: "The art is fine, nothing special but competent enough for the genre." },
  { id: "R5", text: "Plot drags in the middle. The art got noticeably worse after chapter 40." },
]

const pos = (id: string) => ({ review_id: id, stance: "positive" })
const neg = (id: string) => ({ review_id: id, stance: "negative" })
const comp = (id: string) => ({ review_id: id, stance: "competent" })
const mix = (id: string) => ({ review_id: id, stance: "mixed" })

/** Um art4 válido: 3 positivas, ABOVE, citação literal de uma delas. */
const valido = (extra: Record<string, unknown> = {}) => ({
  judging_reviews: [pos("R1"), pos("R2"), pos("R3")],
  quality_signal: "ABOVE_AVERAGE",
  quality_evidence: [{ review_id: "R1", excerpt: "every panel looks like a painting" }],
  change_signal: "NO_CLEAR_SIGNAL",
  change_direction: null,
  change_evidence: [],
  justification: "Leitores elogiam a arte de forma consistente.",
  ...extra,
})

describe("art4 válido", () => {
  it("ABOVE com 3 positivas e citação literal fica rated, com as contagens", () => {
    const a = normalizarArte(valido(), REVIEWS)
    expect(a.version).toBe(ART_SIGNAL_VERSION)
    expect(a.status).toBe("rated")
    expect(a.quality_signal).toBe("ABOVE_AVERAGE")
    expect(a.contagens).toMatchObject({ positive: 3, negative: 0, competent: 0, mixed: 0, total: 3 })
    expect(a.quality_evidence).toEqual([{ review_id: "R1", excerpt: "every panel looks like a painting" }])
    expect(a.rebaixamentos).toEqual([])
    expect(a.justification).toBe("Leitores elogiam a arte de forma consistente.")
  })

  it("INCONCLUSIVE vindo do MODELO é abstained, sem rebaixamento registrado", () => {
    const a = normalizarArte(valido({ quality_signal: "INCONCLUSIVE", quality_evidence: [] }), REVIEWS)
    expect(a.status).toBe("abstained")
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.rebaixamentos).toEqual([])
  })

  it("os parâmetros do produto são os declarados (piso 3, predominância 60%)", () => {
    expect(ART_PISO_REVIEWS).toBe(3)
    expect(ART_PREDOMINANCIA_MINIMA).toBe(0.6)
  })
})

describe("A — menos de 3 reviews julgando a arte", () => {
  it("2 reviews ⇒ INCONCLUSIVE / abstained", () => {
    const a = normalizarArte(valido({ judging_reviews: [pos("R1"), pos("R2")] }), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.status).toBe("abstained")
    expect(a.rebaixamentos.join(" ")).toMatch(/2 review\(s\).*piso 3/)
  })

  it("review DUPLICADA não conta duas vezes: R1, R1, R2 são 2 distintas ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(valido({ judging_reviews: [pos("R1"), pos("R1"), pos("R2")] }), REVIEWS)
    expect(a.julgamentosDescartados).toBe(1)
    expect(a.contagens.total).toBe(2)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("review INEXISTENTE é descartada e não fecha o piso", () => {
    const a = normalizarArte(valido({ judging_reviews: [pos("R1"), pos("R2"), pos("R99")] }), REVIEWS)
    expect(a.julgamentosDescartados).toBe(1)
    expect(a.judging_reviews.map((j) => j.review_id)).toEqual(["R1", "R2"])
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("stance INVÁLIDA é descartada e não fecha o piso", () => {
    const a = normalizarArte(
      valido({ judging_reviews: [pos("R1"), pos("R2"), { review_id: "R3", stance: "loved" }] }),
      REVIEWS,
    )
    expect(a.julgamentosDescartados).toBe(1)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("id com caixa/espaço diferente é o MESMO id (não conta como outra review)", () => {
    const a = normalizarArte(valido({ judging_reviews: [pos("R1"), pos(" r1 "), pos("R2")] }), REVIEWS)
    expect(a.contagens.total).toBe(2)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })
})

describe("B — ABOVE exige positive ≥ 60%", () => {
  it("3 de 5 positivas (60%) fica de pé", () => {
    const a = normalizarArte(
      valido({ judging_reviews: [pos("R1"), pos("R2"), pos("R3"), comp("R4"), neg("R5")] }),
      REVIEWS,
    )
    expect(a.quality_signal).toBe("ABOVE_AVERAGE")
  })

  it("2 de 4 positivas (50%) ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(valido({ judging_reviews: [pos("R1"), pos("R2"), comp("R4"), neg("R5")] }), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.rebaixamentos.join(" ")).toMatch(/positive 2\/4/)
  })
})

describe("C — BELOW exige negative ≥ 60%", () => {
  const below = (judging: unknown[]) =>
    valido({
      judging_reviews: judging,
      quality_signal: "BELOW_AVERAGE",
      quality_evidence: [{ review_id: "R5", excerpt: "The art got noticeably worse" }],
    })

  it("3 de 4 negativas (75%) fica de pé", () => {
    const a = normalizarArte(below([neg("R5"), neg("R1"), neg("R2"), comp("R4")]), REVIEWS)
    expect(a.quality_signal).toBe("BELOW_AVERAGE")
    expect(a.status).toBe("rated")
  })

  it("2 de 4 negativas (50%) ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(below([neg("R5"), neg("R1"), pos("R2"), comp("R4")]), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.rebaixamentos.join(" ")).toMatch(/negative 2\/4/)
  })
})

describe("D — AVERAGE exige competent como MAIOR grupo", () => {
  const average = (judging: unknown[]) =>
    valido({
      judging_reviews: judging,
      quality_signal: "AVERAGE",
      quality_evidence: [{ review_id: "R4", excerpt: "competent enough for the genre" }],
    })

  it("competent maior grupo fica de pé", () => {
    const a = normalizarArte(average([comp("R4"), comp("R1"), pos("R2")]), REVIEWS)
    expect(a.quality_signal).toBe("AVERAGE")
  })

  it("competent EMPATADO com outro grupo não é maior ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(average([comp("R4"), comp("R1"), pos("R2"), pos("R3")]), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("AVERAGE como saída de dúvida (positivas e negativas, nenhum competent) ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(average([pos("R1"), pos("R2"), neg("R5"), mix("R4")]), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.rebaixamentos.join(" ")).toMatch(/competent \(0\) não é o maior grupo/)
  })
})

describe("E — rótulo sem citação literal válida", () => {
  it("trecho que NÃO está na review ⇒ citação descartada ⇒ INCONCLUSIVE", () => {
    const a = normalizarArte(
      valido({ quality_evidence: [{ review_id: "R1", excerpt: "the best art I have ever seen" }] }),
      REVIEWS,
    )
    expect(a.citacoesDescartadas).toBe(1)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
    expect(a.quality_evidence).toEqual([])
  })

  it("citação de review INEXISTENTE é descartada", () => {
    const a = normalizarArte(valido({ quality_evidence: [{ review_id: "R42", excerpt: "every panel looks like a painting" }] }), REVIEWS)
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("citação literal de review FORA de judging_reviews não sustenta a qualidade", () => {
    const a = normalizarArte(
      valido({ quality_evidence: [{ review_id: "R4", excerpt: "competent enough for the genre" }] }),
      REVIEWS,
    )
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })

  it("diferença só de GRAFIA (aspas curvas, caixa) não derruba a citação", () => {
    const reviews = [...REVIEWS.slice(0, 2), { id: "R3", text: "Honestly it’s GORGEOUS artwork, truly lovely." }]
    const a = normalizarArte(
      valido({ quality_evidence: [{ review_id: "R3", excerpt: "it's gorgeous artwork" }] }),
      reviews,
    )
    expect(a.quality_signal).toBe("ABOVE_AVERAGE")
  })

  it("trecho unido por reticências continua descartado", () => {
    const a = normalizarArte(
      valido({ quality_evidence: [{ review_id: "R1", excerpt: "The art is ... like a painting" }] }),
      REVIEWS,
    )
    expect(a.quality_signal).toBe("INCONCLUSIVE")
  })
})

describe("mudança (regras do art3)", () => {
  it("CHANGE_NOTED com trecho literal e direção fica de pé — a citação NÃO precisa julgar o nível", () => {
    const a = normalizarArte(
      valido({
        change_signal: "PROBLEMATIC_CHANGE",
        change_direction: "WORSENED",
        change_evidence: [{ review_id: "R5", excerpt: "The art got noticeably worse after chapter 40" }],
      }),
      REVIEWS,
    )
    expect(a.change_signal).toBe("PROBLEMATIC_CHANGE")
    expect(a.change_direction).toBe("WORSENED")
    expect(a.quality_signal).toBe("ABOVE_AVERAGE") // eixos independentes
  })

  it("mudança sem trecho válido ⇒ NO_CLEAR_SIGNAL e a direção some", () => {
    const a = normalizarArte(
      valido({ change_signal: "CHANGE_NOTED", change_direction: "IMPROVED", change_evidence: [] }),
      REVIEWS,
    )
    expect(a.change_signal).toBe("NO_CLEAR_SIGNAL")
    expect(a.change_direction).toBeNull()
  })

  it("mudança com trecho válido e direção inválida ⇒ MIXED_OR_UNCLEAR", () => {
    const a = normalizarArte(
      valido({
        change_signal: "CHANGE_NOTED",
        change_direction: "SIDEWAYS",
        change_evidence: [{ review_id: "R5", excerpt: "art got noticeably worse" }],
      }),
      REVIEWS,
    )
    expect(a.change_direction).toBe("MIXED_OR_UNCLEAR")
  })
})

describe("estrutura — invalid ≠ abstained, e nada lança", () => {
  const casos: Array<[string, unknown]> = [
    ["art ausente (undefined)", undefined],
    ["art null", null],
    ["art string", "ABOVE_AVERAGE"],
    ["art lista", [valido()]],
    ["quality_signal fora do enum", valido({ quality_signal: "GREAT" })],
    ["quality_signal numérico", valido({ quality_signal: 8 })],
    ["change_signal fora do enum", valido({ change_signal: "YES" })],
    ["judging_reviews ausente", { ...valido(), judging_reviews: undefined }],
    ["judging_reviews string", valido({ judging_reviews: "R1,R2,R3" })],
  ]
  for (const [nome, raw] of casos) {
    it(`${nome} ⇒ invalid, os dois eixos em abstenção`, () => {
      const a = normalizarArte(raw, REVIEWS)
      expect(a.status).toBe("invalid")
      expect(a.quality_signal).toBe("INCONCLUSIVE")
      expect(a.change_signal).toBe("NO_CLEAR_SIGNAL")
      expect(a.rebaixamentos.length).toBeGreaterThan(0)
    })
  }

  it("itens lixo DENTRO das listas não lançam (null, números, objetos vazios)", () => {
    const a = normalizarArte(
      valido({
        judging_reviews: [null, 3, {}, pos("R1"), pos("R2"), pos("R3")],
        quality_evidence: [null, { review_id: 7 }, { review_id: "R1", excerpt: "every panel looks like a painting" }],
        change_evidence: "nada",
      }),
      REVIEWS,
    )
    expect(a.status).toBe("rated")
    expect(a.julgamentosDescartados).toBe(3)
  })

  it("um getter que lança dentro do art vira invalid, não exceção", () => {
    const hostil = valido()
    Object.defineProperty(hostil, "quality_evidence", {
      get() {
        throw new Error("boom")
      },
    })
    const a = normalizarArte(hostil, REVIEWS)
    expect(a.status).toBe("invalid")
    expect(a.rebaixamentos[0]).toMatch(/boom/)
  })
})
