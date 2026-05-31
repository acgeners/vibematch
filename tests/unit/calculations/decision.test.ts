import { describe, it, expect } from "vitest"
import { computeDecisionScore } from "@/lib/calculations/decision"

describe("computeDecisionScore", () => {
  it("retorna null quando não há Nota Prevista (sem âncora)", () => {
    expect(
      computeDecisionScore({ expected: null, fit: 0.5, alignment: 90, confidence: 1 }),
    ).toBeNull()
  })

  it("alignment NULL não muda o resultado (graceful)", () => {
    const semFit = computeDecisionScore({ expected: 8, fit: null, alignment: null })
    // fit null → modulação neutra → resultado é a própria Prevista.
    expect(semFit).toBeCloseTo(8, 5)
  })

  it("fit alto resulta em score maior que fit baixo (mesma Prevista)", () => {
    const alto = computeDecisionScore({ expected: 8, fit: 0.5, alignment: null })!
    const baixo = computeDecisionScore({ expected: 8, fit: 0.0, alignment: null })!
    const neutro = computeDecisionScore({ expected: 8, fit: null, alignment: null })!
    const meio = computeDecisionScore({ expected: 8, fit: 0.25, alignment: null })!
    expect(alto).toBeGreaterThan(baixo)
    // Ponto neutro em FIT_REF/2 = 0.25 → modulação 1.0 ≈ Prevista crua e fit null.
    expect(meio).toBeCloseTo(neutro, 5)
    expect(meio).toBeCloseTo(8, 5)
    // Modulação limitada: no máximo ±10% sobre a Prevista.
    expect(alto).toBeCloseTo(8 * 1.1, 5)
    expect(baixo).toBeCloseTo(8 * 0.9, 5)
  })

  it("alignment confiante e alto eleva o score acima da base", () => {
    const base = computeDecisionScore({ expected: 7, fit: 0.5, alignment: null })!
    const comIa = computeDecisionScore({ expected: 7, fit: 0.5, alignment: 95, confidence: 1 })!
    expect(comIa).toBeGreaterThan(base)
  })

  it("alignment baixo e confiante puxa o score pra baixo", () => {
    const base = computeDecisionScore({ expected: 8, fit: 0.5, alignment: null })!
    const comIa = computeDecisionScore({ expected: 8, fit: 0.5, alignment: 20, confidence: 1 })!
    expect(comIa).toBeLessThan(base)
  })

  it("confiança baixa reduz a influência da IA Rk.", () => {
    const base = computeDecisionScore({ expected: 7, fit: 0.5, alignment: null })!
    const confAlta = computeDecisionScore({ expected: 7, fit: 0.5, alignment: 95, confidence: 1 })!
    const confBaixa = computeDecisionScore({ expected: 7, fit: 0.5, alignment: 95, confidence: 0.1 })!
    // Quanto menor a confiança, mais perto da base (menos puxa pro alignment).
    expect(confBaixa).toBeLessThan(confAlta)
    expect(confBaixa).toBeGreaterThan(base)
  })

  it("o peso do alignment é capado — nunca domina a Prevista", () => {
    // Prevista 4, fit neutro (null → modulação 1.0), alignment máximo (100) e
    // confiança total: o cap (0.35) impede que o score salte pra perto de 10.
    const score = computeDecisionScore({ expected: 4, fit: null, alignment: 100, confidence: 1 })!
    // base 4 × 0.65 + 10 × 0.35 = 6.1
    expect(score).toBeCloseTo(6.1, 5)
    expect(score).toBeLessThan(7)
  })

  it("clampa o resultado em 0–10", () => {
    const alto = computeDecisionScore({ expected: 10, fit: 0.5, alignment: 100, confidence: 1 })!
    expect(alto).toBeLessThanOrEqual(10)
    const baixo = computeDecisionScore({ expected: 0, fit: 0, alignment: 0, confidence: 1 })!
    expect(baixo).toBeGreaterThanOrEqual(0)
  })
})
