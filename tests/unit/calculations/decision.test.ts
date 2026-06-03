import { describe, it, expect } from "vitest"
import { computeDecisionScore } from "@/lib/calculations/decision"

describe("computeDecisionScore", () => {
  it("retorna null quando não há Nota Prevista (sem âncora)", () => {
    expect(computeDecisionScore({ expected: null, alignment: 90, confidence: 1 })).toBeNull()
  })

  it("sem IA Rk, a Nota de Decisão é igual à Prevista (âncora intacta)", () => {
    expect(computeDecisionScore({ expected: 8, alignment: null })).toBeCloseTo(8, 5)
    expect(computeDecisionScore({ expected: 6.3, alignment: null })).toBeCloseTo(6.3, 5)
  })

  it("o fit NÃO entra mais no número (sem double-counting)", () => {
    // Mesma Prevista e mesma IA Rk → mesmo resultado, independente de qualquer
    // alinhamento. O fit virou desempate na exibição, não termo da nota.
    const a = computeDecisionScore({ expected: 8, alignment: null })!
    const b = computeDecisionScore({ expected: 8, alignment: 95, confidence: 1 })!
    // Duas obras com Prevista idêntica e sem IA Rk são empatadas na Decisão,
    // por mais que o fit delas difira.
    expect(computeDecisionScore({ expected: 8, alignment: null })).toBeCloseTo(a, 5)
    // Com IA Rk, o número muda — mas por causa da IA Rk, não do fit.
    expect(b).not.toBeCloseTo(a, 5)
  })

  it("alignment confiante e alto eleva o score acima da Prevista", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null })!
    const comIa = computeDecisionScore({ expected: 7, alignment: 95, confidence: 1 })!
    expect(comIa).toBeGreaterThan(base)
  })

  it("alignment baixo e confiante puxa o score pra baixo", () => {
    const base = computeDecisionScore({ expected: 8, alignment: null })!
    const comIa = computeDecisionScore({ expected: 8, alignment: 20, confidence: 1 })!
    expect(comIa).toBeLessThan(base)
  })

  it("confiança baixa reduz a influência da IA Rk.", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null })!
    const confAlta = computeDecisionScore({ expected: 7, alignment: 95, confidence: 1 })!
    const confBaixa = computeDecisionScore({ expected: 7, alignment: 95, confidence: 0.1 })!
    // Quanto menor a confiança, mais perto da base (menos puxa pro alignment).
    expect(confBaixa).toBeLessThan(confAlta)
    expect(confBaixa).toBeGreaterThan(base)
  })

  it("confidence ausente usa o default (0.6) em vez de ignorar a IA Rk.", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null })!
    const semConf = computeDecisionScore({ expected: 7, alignment: 95 })!
    expect(semConf).toBeGreaterThan(base)
  })

  it("o peso do alignment é capado — nunca domina a Prevista", () => {
    // Prevista 4, alignment máximo (100) e confiança total: o cap (0.35) impede
    // que o score salte pra perto de 10.
    const score = computeDecisionScore({ expected: 4, alignment: 100, confidence: 1 })!
    // base 4 × 0.65 + 10 × 0.35 = 6.1
    expect(score).toBeCloseTo(6.1, 5)
    expect(score).toBeLessThan(7)
  })

  it("clampa o resultado em 0–10", () => {
    const alto = computeDecisionScore({ expected: 10, alignment: 100, confidence: 1 })!
    expect(alto).toBeLessThanOrEqual(10)
    const baixo = computeDecisionScore({ expected: 0, alignment: 0, confidence: 1 })!
    expect(baixo).toBeGreaterThanOrEqual(0)
  })
})
