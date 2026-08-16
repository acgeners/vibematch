import { describe, it, expect } from "vitest"

import {
  buildDecisionBreakdown,
  RIDGE_FEATURE_BY_SIGNAL,
} from "@/lib/calculations/decision-breakdown"
import { computeDecisionScore, decisionAlignWeight, ALIGN_MAX_WEIGHT } from "@/lib/calculations/decision"
import { EXPECTED_BASELINE_FEATURES } from "@/lib/calculations/expected"

const BASE = {
  expected: 8.5,
  alignment: null,
  alignmentConfidence: null,
  personalFitPercentile: 72,
  interestManual: "♥♥♥",
  interestPredicted: "♥♥",
  platformAvg: 7.9063,
  totalVotes: 1036,
  attributesScored: 9,
  attributesTotal: 9,
  weightsAuto: true,
  // A régua do catálogo (migration 193). Sem ela o veredito não ajusta nada, e os
  // casos abaixo deixariam de exercitar o peso — que é o que eles medem.
  verdictScale: { mean: 54.2, sd: 17.8, expectedSd: 0.9 },
}

describe("a explicação DERIVA do cálculo — nunca reescreve a fórmula", () => {
  it("o total é o mesmo número de computeDecisionScore", () => {
    for (const caso of [
      { expected: 8.5, alignment: null, confidence: null },
      { expected: 8.5, alignment: 62, confidence: 0.6 },
      { expected: 7.2, alignment: 95, confidence: 1 },
      { expected: 6.0, alignment: 10, confidence: null },
    ]) {
      const b = buildDecisionBreakdown({
        ...BASE,
        expected: caso.expected,
        alignment: caso.alignment,
        alignmentConfidence: caso.confidence,
      })
      expect(b.total).toBe(computeDecisionScore({ ...caso, verdictScale: BASE.verdictScale }))
    }
  })

  it("o peso mostrado é o mesmo que o cálculo aplicou", () => {
    const b = buildDecisionBreakdown({ ...BASE, alignment: 62, alignmentConfidence: 0.6 })
    expect(b.alignWeight).toBe(decisionAlignWeight(0.6))
    // E é de fato o peso que move a nota: refazendo a conta com ele, dá o total.
    // ⚠️ A conta é a de HOJE (desvio padronizado). Quando isto era
    // `expected×(1−w) + alignment/10×w`, o mesmo veredito 62 — ACIMA da média do
    // catálogo — derrubava a nota, que é o defeito medido em 2026-08-16.
    const z = (62 - BASE.verdictScale.mean) / BASE.verdictScale.sd
    const esperado = BASE.expected + b.alignWeight * BASE.verdictScale.expectedSd * z
    expect(b.total).toBeCloseTo(esperado, 10)
  })

  it("acompanha ALIGN_MAX_WEIGHT sozinha — não tem 0,35 escrito dentro", () => {
    const b = buildDecisionBreakdown({ ...BASE, alignment: 80, alignmentConfidence: 1 })
    expect(b.alignWeight).toBe(ALIGN_MAX_WEIGHT)
  })

  /**
   * 🔴 Sem veredito o peso é ZERO, não o "padrão" de 0,6 de confiança. Um painel que
   * imprimisse "peso 21%" numa obra sem veredito afirmaria um ajuste que não houve —
   * e essa é a MAIORIA das obras (medido em 2026-08-15: 71,1% têm veredito, 28,9% não).
   */
  it("sem Veredito IA, o peso é 0 e o total é a Prevista intacta", () => {
    const b = buildDecisionBreakdown({ ...BASE, alignment: null })
    expect(b.alignWeight).toBe(0)
    expect(b.total).toBe(BASE.expected)
    expect(b.alignment).toBeNull()
  })

  /**
   * 🔴 Sem RÉGUA o veredito não ajusta (ver decision.ts), então o painel não pode
   * imprimir um peso: ele estaria descrevendo um ajuste que a nota não sofreu.
   */
  it("sem a régua do catálogo, o peso é 0 mesmo havendo veredito", () => {
    const b = buildDecisionBreakdown({ ...BASE, alignment: 80, alignmentConfidence: 1, verdictScale: null })
    expect(b.alignWeight).toBe(0)
    expect(b.total).toBe(BASE.expected)
  })

  it("sem Nota Prevista não há Prioridade — e o painel não inventa uma", () => {
    const b = buildDecisionBreakdown({ ...BASE, expected: null, alignment: 90 })
    expect(b.total).toBeNull()
    expect(b.expected).toBeNull()
  })
})

describe("os cinco sinais 'já dentro da Prevista'", () => {
  it("lista os cinco, com o valor da obra na unidade de cada um", () => {
    const b = buildDecisionBreakdown(BASE)
    expect(b.insideExpected.map((s) => [s.key, s.value])).toEqual([
      ["attributes", "9 de 9"],
      ["alignment", "72%"],
      ["interest", "♥♥♥ (seu)"],
      ["platform", "7,9"],
      ["votes", "1.036"],
    ])
  })

  /**
   * A régua do "interesse efetivo" do recalc: o manual manda, a previsão só preenche
   * a ausência. Invertida, a tela diria que a IA opinou onde a pessoa já tinha opinado.
   */
  it("o Interesse MANUAL vence o previsto, e a origem é dita", () => {
    const interesse = (b: ReturnType<typeof buildDecisionBreakdown>) =>
      b.insideExpected.find((s) => s.key === "interest")!.value
    expect(interesse(buildDecisionBreakdown(BASE))).toBe("♥♥♥ (seu)")
    expect(interesse(buildDecisionBreakdown({ ...BASE, interestManual: null }))).toBe("♥♥ (previsto)")
  })

  /**
   * 🔴 A ênfase dos 9 atributos tem DOIS donos possíveis, e a tela precisa dizer qual
   * está valendo. Medido em 2026-08-15: com `score_weights_auto` LIGADO (o estado de
   * hoje) os pesos declarados em `/preferences` são só fallback, e os dois divergem
   * em 7 dos 9 — `tragedy` declarado −15 contra +11,4 inferido, sinal INVERTIDO.
   * Omitir isso deixa quem declarou um peso achando que ele está em vigor.
   */
  it("diz QUAL ênfase dos atributos está em vigor, e nomeia o dono", () => {
    const auto = buildDecisionBreakdown({ ...BASE, weightsAuto: true }).weightsNote
    const manual = buildDecisionBreakdown({ ...BASE, weightsAuto: false }).weightsNote
    expect(auto).toMatch(/autom/i)
    // Não basta dizer "automática": tem que dizer que a SUA declaração não está valendo.
    expect(auto).toMatch(/não a de \/preferences/i)
    expect(manual).toMatch(/a sua/i)
    expect(manual).toMatch(/preferences/i)
    // E a ênfase NÃO polui o valor por-obra da linha de atributos.
    const valor = (a: boolean) =>
      buildDecisionBreakdown({ ...BASE, weightsAuto: a }).insideExpected.find((s) => s.key === "attributes")!.value
    expect(valor(true)).toBe("9 de 9")
    expect(valor(false)).toBe("9 de 9")
  })

  it("ausência vira uma DICA do que falta, nunca zero", () => {
    const b = buildDecisionBreakdown({
      ...BASE,
      personalFitPercentile: null,
      interestManual: null,
      interestPredicted: null,
      platformAvg: null,
      totalVotes: 0,
      attributesScored: 0,
    })
    for (const s of b.insideExpected) {
      expect(s.value).toBeNull()
      expect(s.emptyHint.length).toBeGreaterThan(0)
    }
    // 0 votos é "sem votos", não "0" — a diferença é entre não saber e saber que é zero.
    expect(b.insideExpected.find((s) => s.key === "votes")!.value).toBeNull()
  })
})

/**
 * 🔴 A tela AFIRMA que estes sinais entram na Nota Prevista. A afirmação só é
 * verdadeira enquanto as features existirem no Ridge — se uma for renomeada ou
 * removida, a frase passa a mentir e nada acusaria.
 *
 * A checagem mora AQUI e não no módulo por peso de bundle: o consumidor é
 * `"use client"`, e importar `expected.ts` levaria `lib/ml/{ridge,preprocessing}`
 * pro navegador (mesmo motivo de `lib/arte/bands.ts` existir).
 */
describe("guarda: os sinais citados existem MESMO no Ridge", () => {
  it("cada feature afirmada está em EXPECTED_BASELINE_FEATURES", () => {
    const reais = new Set<string>(EXPECTED_BASELINE_FEATURES as readonly string[])
    const ausentes = Object.entries(RIDGE_FEATURE_BY_SIGNAL)
      .filter(([, feature]) => !reais.has(feature))
      .map(([sinal, feature]) => `${sinal} → ${feature}`)
    expect(ausentes, "o painel afirma que um sinal entra na Prevista, e ele não entra mais").toEqual([])
  })

  it("todo sinal listado no painel tem uma feature declarada", () => {
    const doPainel = buildDecisionBreakdown(BASE).insideExpected.map((s) => s.key)
    expect(doPainel.sort()).toEqual(Object.keys(RIDGE_FEATURE_BY_SIGNAL).sort())
  })
})
