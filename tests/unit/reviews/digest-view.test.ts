import { describe, it, expect } from "vitest"
import {
  collectUserRatings,
  defaultAxisKey,
  groupTraitsByAxis,
  normalizeAxis,
  ratingHistogram,
  reviewSignal,
  MIN_RATINGS_FOR_HISTOGRAM,
} from "@/lib/reviews/digest-view"
import type { ReviewDigestTrait } from "@/lib/ai-recommendation/types"

const t = (trait: string, polarity: ReviewDigestTrait["polarity"], axis: string): ReviewDigestTrait => ({
  trait,
  polarity,
  axis,
})

describe("normalizeAxis", () => {
  it("mapeia os 8 eixos que cobrem 99,1% dos traços medidos", () => {
    expect(normalizeAxis("personagens").label).toBe("Personagens")
    expect(normalizeAxis("MORALIDADE").label).toBe("Moralidade")
    expect(normalizeAxis(" ritmo ").label).toBe("Ritmo")
  })

  it("corta no primeiro segmento antes da barra", () => {
    expect(normalizeAxis("execução/publicação").key).toBe("execução")
  })

  // Forçar um valor desconhecido para dentro dos 8 conhecidos ("roteiro" → "escrita")
  // mentiria sobre o que a review disse. Ele entra com rótulo próprio.
  it("preserva eixo desconhecido em vez de remapear", () => {
    expect(normalizeAxis("cronologia")).toEqual({ key: "cronologia", label: "Cronologia" })
  })

  it("cai em Outros quando o eixo vem vazio ou nulo", () => {
    expect(normalizeAxis("").key).toBe("outros")
    expect(normalizeAxis(null).key).toBe("outros")
  })
})

describe("groupTraitsByAxis", () => {
  const traits = [
    t("vilao raso", "negative", "personagens"),
    t("premissa incomum", "positive", "originalidade"),
    t("protagonista calculista", "positive", "personagens"),
    t("arte cai depois", "negative", "arte"),
    t("ritmo trava no meio", "negative", "ritmo"),
    t("ritmo repetitivo", "negative", "ritmo"),
  ]

  it("ordena pelo saldo, do que mais agrada ao que mais incomoda", () => {
    // saldos: originalidade +1 · personagens 0 · arte −1 · ritmo −2
    expect(groupTraitsByAxis(traits).map((g) => g.key)).toEqual([
      "originalidade",
      "personagens",
      "arte",
      "ritmo",
    ])
  })

  it("dá tom e veredito pelo saldo, não pela contagem bruta", () => {
    const groups = groupTraitsByAxis(traits)
    const by = Object.fromEntries(groups.map((g) => [g.key, g]))
    expect(by.originalidade.tone).toBe("positive")
    expect(by.originalidade.verdict).toBe("elogiado")
    // 1 positivo + 1 negativo = saldo 0 → dividido, mesmo sem nenhum traço "mixed".
    expect(by.personagens.tone).toBe("mixed")
    expect(by.personagens.verdict).toBe("dividido")
    expect(by.ritmo.verdict).toBe("criticado")
  })

  // A intensidade (glifos repetidos) conta só o tom DOMINANTE; o contador da linha conta
  // todos os traços do eixo. Confundir os dois faz "▼▼" aparecer num eixo com 1 crítica.
  it("separa intensidade do tom dominante do total de traços", () => {
    const groups = groupTraitsByAxis([
      t("discurso inconsistente", "negative", "moralidade"),
      t("dinamica de poder desigual", "mixed", "moralidade"),
    ])
    expect(groups[0].intensity).toBe(1)
    expect(groups[0].traits).toHaveLength(2)
    expect(groups[0].verdict).toBe("criticado")
  })

  it("ignora traço sem texto e aceita lista vazia ou nula", () => {
    expect(groupTraitsByAxis([t("   ", "positive", "arte")])).toHaveLength(0)
    expect(groupTraitsByAxis([])).toEqual([])
    expect(groupTraitsByAxis(null)).toEqual([])
  })
})

describe("defaultAxisKey", () => {
  it("abre no eixo mais citado, não no primeiro da régua", () => {
    const groups = groupTraitsByAxis([
      t("premissa incomum", "positive", "originalidade"),
      t("vilao raso", "negative", "personagens"),
      t("protagonista calculista", "positive", "personagens"),
    ])
    expect(groups[0].key).toBe("originalidade") // topo da régua
    expect(defaultAxisKey(groups)).toBe("personagens") // mas o painel abre no mais citado
  })

  it("devolve null sem eixos", () => {
    expect(defaultAxisKey([])).toBeNull()
  })
})

describe("reviewSignal", () => {
  it("classifica pela combinação de reviews e fontes", () => {
    expect(reviewSignal(96, 7).strength).toBe("forte")
    expect(reviewSignal(21, 3).strength).toBe("forte")
    // Muitas reviews de UMA fonte só não são sinal forte: o consenso vira o da fonte.
    expect(reviewSignal(90, 1).strength).toBe("fraco")
    expect(reviewSignal(10, 2).strength).toBe("moderado")
    expect(reviewSignal(2, 1).strength).toBe("fraco")
  })

  it("acende no máximo 4 barras e no mínimo 1", () => {
    for (const [n, s] of [[96, 7], [10, 2], [5, 1], [1, 1]] as const) {
      const { bars } = reviewSignal(n, s)
      expect(bars).toBeGreaterThanOrEqual(1)
      expect(bars).toBeLessThanOrEqual(4)
    }
  })
})

describe("ratingHistogram", () => {
  it("não desenha nada abaixo do mínimo de notas", () => {
    expect(ratingHistogram([8, 9, 7, 6]).bins).toEqual([])
    expect(MIN_RATINGS_FOR_HISTOGRAM).toBe(5)
  })

  // 🔴 Sem os bins vazios do meio, a escala mente: 8,5 e 10 apareceriam colados, como se
  // não houvesse distância entre eles.
  it("inclui os bins vazios entre o menor e o maior", () => {
    const { bins, total } = ratingHistogram([5.5, 6, 6, 6, 7, 7, 8, 8.5, 10, 10])
    expect(total).toBe(10)
    expect(bins.map((b) => b.score)).toEqual([5, 6, 7, 8, 9, 10])
    expect(bins.find((b) => b.score === 9)?.count).toBe(0)
    expect(bins.find((b) => b.score === 6)?.count).toBe(3)
    // 8,5 cai no bin 8 (piso), não no 9.
    expect(bins.find((b) => b.score === 8)?.count).toBe(2)
  })

  it("pinta baixo/médio/alto pelo valor do bin", () => {
    const { bins } = ratingHistogram([4, 5, 6, 7, 8, 9])
    expect(bins.find((b) => b.score === 4)?.tone).toBe("low")
    expect(bins.find((b) => b.score === 7)?.tone).toBe("mid")
    expect(bins.find((b) => b.score === 9)?.tone).toBe("high")
  })

  it("descarta nota fora de 0–10 e não quebra com NaN", () => {
    const { total } = ratingHistogram([8, 9, 7, 6, 5, 42, Number.NaN, -1])
    expect(total).toBe(5)
  })
})

describe("collectUserRatings", () => {
  it("junta as notas das fontes e ignora as nulas", () => {
    const ratings = collectUserRatings([
      { reviews: [{ userRating: 8 }, { userRating: null }] },
      { reviews: [{ userRating: 6.5 }] },
    ])
    expect(ratings).toEqual([8, 6.5])
  })
})
