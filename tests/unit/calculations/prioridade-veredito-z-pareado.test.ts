import { describe, it, expect } from "vitest"

import {
  ALIGN_MAX_WEIGHT,
  STALE_CONFIDENCE_FACTOR,
  computeDecisionScore,
  computeVerdictScale,
  decisionAlignWeight,
  type VerdictScale,
} from "@/lib/calculations/decision"

/**
 * O Veredito ajusta a Prioridade por DESVIO PADRONIZADO, e não pelo valor cru.
 *
 * 🔴 O defeito que estes casos impedem foi medido em 2026-08-16: `alignment/10`
 * entrava 2,27 pontos abaixo da âncora (veredito médio 54,2 × Prevista 76,9 na
 * escala 0–100), então 625 das 695 obras com veredito DESCIAM — e como 29% do
 * catálogo não tem veredito, quem não passou pelo re-rank subia de graça
 * (37.148 pares invertendo a favor dele, contra 82 no sentido oposto).
 */

const ESCALA: VerdictScale = { mean: 54.2, sd: 17.8, expectedSd: 0.9 }

describe("Prioridade: o Veredito entra como desvio padronizado", () => {
  it("veredito NA MÉDIA do catálogo não move a nota", () => {
    // A propriedade que define a correção: o ajuste é centrado, então ter
    // veredito deixa de ser, por si só, um motivo pra subir ou descer.
    const score = computeDecisionScore({
      expected: 8,
      alignment: ESCALA.mean,
      confidence: 1,
      verdictScale: ESCALA,
    })
    expect(score).toBeCloseTo(8, 10)
  })

  it("acima da média sobe, abaixo desce, e simetricamente", () => {
    const base = { expected: 8, confidence: 1, verdictScale: ESCALA }
    const acima = computeDecisionScore({ ...base, alignment: ESCALA.mean + ESCALA.sd })!
    const abaixo = computeDecisionScore({ ...base, alignment: ESCALA.mean - ESCALA.sd })!

    expect(acima).toBeGreaterThan(8)
    expect(abaixo).toBeLessThan(8)
    expect(acima - 8).toBeCloseTo(8 - abaixo, 10)
    // Um σ de veredito vale ALIGN_MAX_WEIGHT × um σ de Prevista — é o que mantém o
    // ajuste do tamanho da variação que já existe no número ajustado.
    expect(acima - 8).toBeCloseTo(ALIGN_MAX_WEIGHT * ESCALA.expectedSd, 10)
  })

  it("SEM régua, o veredito não ajusta nada — a Prioridade é a Prevista", () => {
    // O lado seguro: sem saber onde este veredito cai na distribuição, qualquer
    // conversão de escala é chute, e o chute anterior custava meio ponto.
    for (const scale of [null, undefined]) {
      expect(
        computeDecisionScore({ expected: 7.3, alignment: 95, confidence: 1, verdictScale: scale }),
      ).toBe(7.3)
    }
  })

  it("NÃO reproduz a fórmula antiga: veredito alto não é puxado pra `alignment/10`", () => {
    // Contraprova do defeito. Na fórmula antiga, um veredito de 62 (acima da média
    // do catálogo!) DERRUBAVA uma obra de 8,0 — porque 6,2 < 8,0. Hoje ele sobe.
    const antiga = 8 * (1 - 0.35) + (62 / 10) * 0.35
    const nova = computeDecisionScore({
      expected: 8,
      alignment: 62,
      confidence: 1,
      verdictScale: ESCALA,
    })!

    expect(antiga).toBeLessThan(8)
    expect(nova).toBeGreaterThan(8)
  })

  it("obra sem veredito fica com a Prevista intacta — e não perde pra quem tem", () => {
    const semVeredito = computeDecisionScore({
      expected: 8,
      alignment: null,
      verdictScale: ESCALA,
    })!
    const comVereditoMediano = computeDecisionScore({
      expected: 8,
      alignment: ESCALA.mean,
      verdictScale: ESCALA,
    })!
    expect(semVeredito).toBe(8)
    expect(comVereditoMediano).toBeCloseTo(semVeredito, 10)
  })

  it("veredito DESATUALIZADO opina com metade da força", () => {
    const base = { expected: 8, alignment: ESCALA.mean + ESCALA.sd, confidence: 1, verdictScale: ESCALA }
    const fresco = computeDecisionScore(base)! - 8
    const velho = computeDecisionScore({ ...base, stale: true })! - 8

    expect(velho).toBeCloseTo(fresco * STALE_CONFIDENCE_FACTOR, 10)
    expect(decisionAlignWeight(1, true)).toBeCloseTo(ALIGN_MAX_WEIGHT * STALE_CONFIDENCE_FACTOR, 10)
  })

  it("sem Nota Prevista não há Prioridade, mesmo com veredito", () => {
    expect(
      computeDecisionScore({ expected: null, alignment: 90, verdictScale: ESCALA }),
    ).toBeNull()
  })
})

describe("a régua sai do catálogo", () => {
  it("mede média e σ do veredito e σ da Prevista", () => {
    const escala = computeVerdictScale([
      { expected: 7, alignment: 40 },
      { expected: 8, alignment: 60 },
      { expected: 9, alignment: 50 },
    ])!
    expect(escala.mean).toBeCloseTo(50, 10)
    expect(escala.sd).toBeCloseTo(Math.sqrt(200 / 3), 10)
    expect(escala.expectedSd).toBeCloseTo(Math.sqrt(2 / 3), 10)
  })

  it("obra sem veredito não entra na média do veredito, mas entra no σ da Prevista", () => {
    // Contar a ausência como zero deslocaria o centro pra baixo — que é a própria
    // classe de erro que esta régua corrige.
    const escala = computeVerdictScale([
      { expected: 7, alignment: 40 },
      { expected: 9, alignment: 60 },
      { expected: 5, alignment: null },
    ])!
    expect(escala.mean).toBeCloseTo(50, 10)
    expect(escala.expectedSd).toBeGreaterThan(1)
  })

  it("sem dispersão para medir, devolve null (e aí o ajuste não se aplica)", () => {
    expect(computeVerdictScale([])).toBeNull()
    expect(computeVerdictScale([{ expected: 8, alignment: 50 }])).toBeNull()
    // Todos iguais: σ zero viraria divisão por zero e o clamp jogaria a obra
    // pra 0 ou 10 — um "ajuste" que substitui a âncora.
    expect(
      computeVerdictScale([
        { expected: 8, alignment: 50 },
        { expected: 8, alignment: 50 },
      ]),
    ).toBeNull()
  })
})
