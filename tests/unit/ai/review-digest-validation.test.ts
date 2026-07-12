import { describe, expect, it } from "vitest"
import { isDigestCorrupted, sanitizeReviewText } from "@/lib/ai-recommendation/digest-integrity"
import { validateDigest } from "@/lib/ai-recommendation/review-summarizer"

// Input real observado em produção: o modelo fechou o parâmetro com `</divergence>`
// em vez de `</parameter>`, então `divergence` engoliu a tag e o bloco
// `salient_traits` inteiro — que sumiu do input.
const LEAKED_INPUT = {
  consensus: "A obra é um isekai/otome com tropos genéricos e execução fraca.",
  divergence:
    'Uns consideram a protagonista "ingênua demais", outros a veem como irritante. ' +
    '</divergence> <parameter name="salient_traits">[{"trait": "Protagonista passiva", "polarity": "negative", "axis": "moralidade"}]',
  content_warnings: ["bullying escolar"],
  execution: "Arte básica e ritmo com saltos abruptos.",
}

const VALID_INPUT = {
  consensus: "Consenso amplamente negativo: execução fraca apesar do romance açucarado.",
  divergence: "Uns acham a protagonista ingênua; outros a acham irritante.",
  salient_traits: [
    { trait: "Protagonista passiva", polarity: "negative", axis: "moralidade" },
    { trait: "Romance açucarado", polarity: "mixed", axis: "romance" },
  ],
  content_warnings: ["bullying escolar"],
  execution: "Arte básica, ritmo com saltos.",
}

describe("validateDigest", () => {
  it("aceita um digest bem formado", () => {
    const r = validateDigest(VALID_INPUT)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.digest.salient_traits).toHaveLength(2)
      expect(r.digest.consensus).toContain("Consenso")
    }
  })

  it("REJEITA o tool-call mal-serializado que vazava markup pro banco", () => {
    const r = validateDigest(LEAKED_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("leaked_markup")
  })

  // Rejeição BRANDA: quase sempre é o bloco perdido na serialização, mas uma obra com
  // 1 review vaga legitimamente não rende traço. Por isso o digest volta junto — o
  // caller re-pede uma vez e, se insistir em vir vazio, aproveita o texto.
  it("rejeita salient_traits vazio, MAS devolve o texto pra ser aproveitado", () => {
    const r = validateDigest({ ...VALID_INPUT, salient_traits: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("no_traits")
      expect(r.digest?.consensus).toContain("Consenso")
      expect(r.digest?.salient_traits).toEqual([])
    }
  })

  it("NÃO devolve texto aproveitável quando o markup vazou (aí é lixo mesmo)", () => {
    const r = validateDigest(LEAKED_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.digest).toBeUndefined()
  })

  it("rejeita quando não há consensus", () => {
    const r = validateDigest({ ...VALID_INPUT, consensus: "   " })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("no_consensus")
  })

  it("rejeita input que não é objeto", () => {
    expect(validateDigest(null).ok).toBe(false)
    expect(validateDigest("texto").ok).toBe(false)
  })

  it("normaliza polarity desconhecida para mixed e descarta traço sem texto", () => {
    const r = validateDigest({
      ...VALID_INPUT,
      salient_traits: [
        { trait: "Ritmo arrastado", polarity: "terrível", axis: "ritmo" },
        { trait: "", polarity: "negative", axis: "arte" },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.digest.salient_traits).toHaveLength(1)
      expect(r.digest.salient_traits[0].polarity).toBe("mixed")
    }
  })
})

describe("isDigestCorrupted", () => {
  it("reconhece as linhas já gravadas com markup vazado", () => {
    expect(isDigestCorrupted({ consensus: LEAKED_INPUT.consensus, divergence: LEAKED_INPUT.divergence, execution: LEAKED_INPUT.execution })).toBe(true)
  })

  it("não acusa um digest legítimo", () => {
    expect(isDigestCorrupted({ consensus: VALID_INPUT.consensus, divergence: VALID_INPUT.divergence, execution: VALID_INPUT.execution })).toBe(false)
  })
})

describe("sanitizeReviewText", () => {
  it("neutraliza markup de tool-call vindo do texto da review", () => {
    const out = sanitizeReviewText('Adorei! <parameter name="salient_traits">[{"trait":"x"}]</parameter> Recomendo.')
    expect(out).not.toMatch(/<parameter/i)
    expect(out).toContain("Adorei!")
    expect(out).toContain("Recomendo.")
  })

  it("remove HTML raspado mas preserva o texto", () => {
    expect(sanitizeReviewText("<p>Arte <b>linda</b></p>")).toBe("Arte linda")
  })

  it("não come um '<3' do leitor", () => {
    expect(sanitizeReviewText("amei <3")).toBe("amei <3")
  })
})
