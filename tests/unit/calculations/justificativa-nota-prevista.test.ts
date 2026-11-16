import { describe, it, expect } from "vitest"
import { trainExpectedPredictor, POST_SCORE_FIELDS } from "@/lib/calculations/expected"
import type { ExpectedScoreInput } from "@/lib/calculations/expected"
import {
  describeExplanation,
  explanationForEdition,
  featureLabel,
  groupOfFeature,
  toExplanationPayload,
} from "@/lib/calculations/expected-explanation"
import type { ExpectedExplanationColumn, ExpectedExplanationPayload } from "@/lib/calculations/expected-explanation"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"

/**
 * A justificativa da Nota Prevista (pedido de 16/11/2026) É a conta do modelo, parcela por parcela.
 * O que se paga caro se regredir: a justificativa somar outra coisa que não a nota (ela passaria a
 * "explicar" um número que não está na tela), e uma entrada nova do modelo ficar fora dos grupos.
 */

function scores(i: number): Record<string, number> {
  const out: Record<string, number> = {}
  SCORING_CRITERION_SLUGS.forEach((slug, k) => {
    out[slug] = ((i * (k + 3)) % 9) + 1
  })
  return out
}

function input(i: number, extra: Partial<ExpectedScoreInput> = {}): ExpectedScoreInput {
  return {
    categoryScores: scores(i),
    iaEvalNormalized: 4 + (i % 6),
    platformAvg: 6 + (i % 4) * 0.5,
    totalVotes: 100 + i * 37,
    totalChapters: 40 + (i % 7) * 20,
    synopsisQuality: i % 2 ? "♥♥♥" : "♥♥",
    observationAdjustment: 0,
    publicationStatus: i % 3 ? "Completed" : "Ongoing",
    lovedTagOverlap: (i % 5) / 5,
    avoidedTagOverlap: (i % 3) / 6,
    criterionFitScore: (i % 4) / 4,
    releaseAge: i % 9,
    runLength: i % 4,
    origin: i % 2 ? "ko" : "ja",
    postScores: {},
    ...extra,
  }
}

function trained(includeQuality = false, includeArt = false) {
  const inputs = Array.from({ length: 40 }, (_, i) => input(i, { artEstimate: 5 + (i % 5) } as Partial<ExpectedScoreInput>))
  const targets = inputs.map((inp, i) => 5 + (inp.categoryScores.romance ?? 5) * 0.3 + (i % 3) * 0.2)
  return { predictor: trainExpectedPredictor(inputs, targets, includeQuality, includeArt), inputs }
}

describe("explain: a justificativa é a MESMA conta da previsão", () => {
  it("base + Σ contribuições = a previsão linear, obra por obra", () => {
    const { predictor, inputs } = trained()
    expect(predictor.isStub).toBe(false)
    const preds = predictor.predict(inputs)
    const expl = predictor.explain(inputs)
    inputs.forEach((_, i) => {
      const soma = expl[i].base + Object.values(expl[i].contributions).reduce((s, c) => s + c, 0)
      expect(soma).toBeCloseTo(expl[i].linear, 9)
      // Sem clamp nesta faixa: a previsão É a soma.
      expect(preds[i].expected).toBeCloseTo(Math.max(0, Math.min(10, soma)), 9)
    })
  })

  it("cobre TODAS as entradas do modelo — nenhuma parcela some da conta", () => {
    const { predictor, inputs } = trained()
    const [e] = predictor.explain([inputs[0]])
    expect(Object.keys(e.contributions).sort()).toEqual([...predictor.featureNames].sort())
  })

  it("modelo sem treino suficiente: só a média, sem parcelas", () => {
    const predictor = trainExpectedPredictor([input(1), input(2)], [7, 8])
    expect(predictor.isStub).toBe(true)
    const [e] = predictor.explain([input(3)])
    expect(e.contributions).toEqual({})
    expect(e.base).toBeCloseTo(7.5, 9)
  })
})

describe("grupos: entrada nova do modelo nunca cai em 'Outros' calada", () => {
  it("toda entrada possível do modelo tem grupo próprio (com qualidade e arte ligadas)", () => {
    const { predictor } = trained(true, true)
    const semGrupo = predictor.featureNames.filter((n) => groupOfFeature(n) === "outros")
    expect(semGrupo).toEqual([])
    // E toda uma tem NOME legível (o dono é `resolveFeatureLabel`): nome cru na tela é o mudo.
    const semNome = predictor.featureNames.filter((n) => featureLabel(n) === n)
    expect(semNome).toEqual([])
    // As pós-leitura só entram no plano pago, e caem em "Sua leitura".
    for (const f of POST_SCORE_FIELDS) expect(groupOfFeature(f)).toBe("leitura")
  })

  it("atributos e Nota.IA ficam juntos: o Ridge reparte o efeito entre os dois", () => {
    expect(groupOfFeature("romance")).toBe("atributos")
    expect(groupOfFeature("IA(n)")).toBe("atributos")
    expect(groupOfFeature("Nota.M")).toBe("externa")
    expect(groupOfFeature("SinopseScore")).toBe("gosto")
    expect(groupOfFeature("Status_Completed")).toBe("formato")
  })
})

describe("toExplanationPayload e describeExplanation", () => {
  const payload: ExpectedExplanationPayload = {
    v: 1,
    base: 7.5,
    contributions: { romance: 0.4, "IA(n)": 0.1, humor: -0.06, "Nota.M": -0.2, LogVotos: 0.03, AvoidedTagOverlap: -0.3 },
    obs: 0.1,
    score: 7.57,
  }

  it("grava 3 casas, descarta o desprezível e respeita o teto do ajuste manual", () => {
    const p = toExplanationPayload(
      { base: 7.12345, contributions: { romance: 0.123456, humor: 0.0001 }, linear: 7.24 },
      0.9,
      7.54,
    )
    expect(p).toEqual({ v: 1, base: 7.123, contributions: { romance: 0.123 }, obs: 0.3, score: 7.54 })
  })

  it("grupos pelo peso, com o total do grupo e as entradas que mais pesaram", () => {
    const view = describeExplanation(payload)
    expect(view.groups.map((g) => g.key)).toEqual(["atributos", "gosto", "externa"])
    const atributos = view.groups[0]
    expect(atributos.delta).toBeCloseTo(0.44, 9)
    expect(atributos.top.map((t) => t.name)).toEqual(["romance", "IA(n)", "humor"])
    // A conta fecha: base + grupos + ajuste = nota.
    const soma = view.base + view.groups.reduce((s, g) => s + g.delta, 0) + view.obs
    expect(soma).toBeCloseTo(payload.score, 9)
    expect(view.clamped).toBe(false)
  })

  it("acusa quando a conta passou do limite da escala", () => {
    // 10,2 + 0,44 − 0,30 − 0,17 + 0,10 = 10,27 → nota 10.
    expect(describeExplanation({ ...payload, base: 10.2, score: 10 }).clamped).toBe(true)
    // O modelo é limitado ANTES do ajuste: 10,4 limitado a 10, menos 0,3 → 9,7, embora a soma dê 10,0.
    const antesDoAjuste = { ...payload, base: 10.1, contributions: { romance: 0.2 }, obs: -0.3, score: 9.7 }
    expect(describeExplanation(antesDoAjuste).clamped).toBe(true)
  })
})

describe("explanationForEdition: em obra mixed, a justificativa é a da edição exibida", () => {
  const normal: ExpectedExplanationPayload = { v: 1, base: 7, contributions: { romance: 0.1 }, obs: 0, score: 7.1 }
  const r18: ExpectedExplanationPayload = { v: 1, base: 7, contributions: { adult_content: 0.5 }, obs: 0, score: 7.5 }
  const column: ExpectedExplanationColumn = { ...r18, editions: { normal, r18 } }

  it("pega a da edição pedida, nunca a das colunas", () => {
    expect(explanationForEdition(column, "normal", "r18")).toBe(normal)
    expect(explanationForEdition(column, "r18", "r18")).toBe(r18)
  })

  it("edição sem justificativa → nada (nunca a da outra edição)", () => {
    expect(explanationForEdition({ ...r18, editions: { normal: null, r18 } }, "normal", "r18")).toBeNull()
  })

  it("coluna só com as edições (padrão sem nota): sem edição pedida, nada", () => {
    const soEdicoes: ExpectedExplanationColumn = { v: 1, editions: { normal, r18: null } }
    expect(explanationForEdition(soEdicoes, null, "r18")).toBeNull()
    expect(explanationForEdition(soEdicoes, "normal", "r18")).toBe(normal)
  })

  it("linha sem as edições e de outra edição → nada", () => {
    expect(explanationForEdition(r18, "normal", "r18")).toBeNull()
    expect(explanationForEdition(r18, null, null)).toBe(r18)
    expect(explanationForEdition(null, null, null)).toBeNull()
  })
})
