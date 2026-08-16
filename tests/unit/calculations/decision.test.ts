import { describe, it, expect } from "vitest"
import { ALIGN_MAX_WEIGHT, computeDecisionScore, type VerdictScale } from "@/lib/calculations/decision"

/**
 * ⚠️ Estes casos foram reescritos em 2026-08-16, quando o Veredito passou a entrar
 * por desvio padronizado. A INTENÇÃO de cada um continua a mesma (a âncora manda,
 * o veredito ajusta, a confiança modula, o peso é capado) — o que mudou é que
 * "alto" e "baixo" passaram a ser relativos à distribuição do catálogo, e não ao
 * valor absoluto: um veredito 62 é ALTO num catálogo cuja média é 54,2, e a
 * fórmula antiga o tratava como 6,2 — abaixo de qualquer Prevista razoável.
 * Ver `prioridade-veredito-z-pareado.test.ts` para os casos da régua em si.
 */

const ESCALA: VerdictScale = { mean: 54.2, sd: 17.8, expectedSd: 0.9 }

describe("computeDecisionScore", () => {
  it("retorna null quando não há Nota Prevista (sem âncora)", () => {
    expect(
      computeDecisionScore({ expected: null, alignment: 90, confidence: 1, verdictScale: ESCALA }),
    ).toBeNull()
  })

  it("sem IA Rk, a Nota de Decisão é igual à Prevista (âncora intacta)", () => {
    expect(computeDecisionScore({ expected: 8, alignment: null, verdictScale: ESCALA })).toBeCloseTo(8, 5)
    expect(computeDecisionScore({ expected: 6.3, alignment: null, verdictScale: ESCALA })).toBeCloseTo(6.3, 5)
  })

  it("o fit NÃO entra no número (sem double-counting)", () => {
    // Duas obras com Prevista idêntica e sem IA Rk empatam na Prioridade, por
    // mais que o alinhamento delas difira — ele já está DENTRO da Prevista.
    const a = computeDecisionScore({ expected: 8, alignment: null, verdictScale: ESCALA })!
    const b = computeDecisionScore({ expected: 8, alignment: 95, confidence: 1, verdictScale: ESCALA })!
    expect(computeDecisionScore({ expected: 8, alignment: null, verdictScale: ESCALA })).toBeCloseTo(a, 5)
    // Com IA Rk o número muda — por causa da IA Rk, não do fit.
    expect(b).not.toBeCloseTo(a, 5)
  })

  it("alignment confiante e ACIMA DA MÉDIA eleva o score", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null, verdictScale: ESCALA })!
    const comIa = computeDecisionScore({ expected: 7, alignment: 95, confidence: 1, verdictScale: ESCALA })!
    expect(comIa).toBeGreaterThan(base)
  })

  it("alignment ABAIXO DA MÉDIA e confiante puxa o score pra baixo", () => {
    const base = computeDecisionScore({ expected: 8, alignment: null, verdictScale: ESCALA })!
    const comIa = computeDecisionScore({ expected: 8, alignment: 20, confidence: 1, verdictScale: ESCALA })!
    expect(comIa).toBeLessThan(base)
  })

  it("confiança baixa reduz a influência da IA Rk.", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null, verdictScale: ESCALA })!
    const confAlta = computeDecisionScore({ expected: 7, alignment: 95, confidence: 1, verdictScale: ESCALA })!
    const confBaixa = computeDecisionScore({ expected: 7, alignment: 95, confidence: 0.1, verdictScale: ESCALA })!
    expect(confBaixa).toBeLessThan(confAlta)
    expect(confBaixa).toBeGreaterThan(base)
  })

  it("confidence ausente usa o default (0.6) em vez de ignorar a IA Rk.", () => {
    const base = computeDecisionScore({ expected: 7, alignment: null, verdictScale: ESCALA })!
    const semConf = computeDecisionScore({ expected: 7, alignment: 95, verdictScale: ESCALA })!
    expect(semConf).toBeGreaterThan(base)
  })

  it("o peso do alignment é capado — nunca domina a Prevista", () => {
    // Prevista 4, veredito máximo (100) e confiança total. O cap segura o ajuste
    // em ALIGN_MAX_WEIGHT × σ da Prevista por σ de veredito: com o veredito a
    // 2,57σ da média, isso são ~0,81 ponto — não um salto pra perto de 10.
    const score = computeDecisionScore({ expected: 4, alignment: 100, confidence: 1, verdictScale: ESCALA })!
    const z = (100 - ESCALA.mean) / ESCALA.sd
    expect(score).toBeCloseTo(4 + ALIGN_MAX_WEIGHT * ESCALA.expectedSd * z, 5)
    expect(score).toBeLessThan(5)
  })

  it("clampa o resultado em 0–10", () => {
    const alto = computeDecisionScore({ expected: 10, alignment: 100, confidence: 1, verdictScale: ESCALA })!
    expect(alto).toBeLessThanOrEqual(10)
    const baixo = computeDecisionScore({ expected: 0, alignment: 0, confidence: 1, verdictScale: ESCALA })!
    expect(baixo).toBeGreaterThanOrEqual(0)
  })
})
