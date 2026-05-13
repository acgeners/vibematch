import { describe, it, expect } from "vitest"
import { calculateNotaCalc } from "@/lib/calculations/score"
import { calculateNotaFinal } from "@/lib/calculations/final"

describe("calculateNotaCalc", () => {
  const base = {
    gptNormalized: 7.5,
    platformAvg: 8.0,
    totalVotes: 1000,
    chaptersNormalized: 8.0,
    publicationStatus: "C" as const,
    synopsisQuality: "♥♥♥" as const,
    observationPenalty: 0,
    pseudoVotesBlend: 1024,
  }

  it("retorna valor entre 0 e 10", () => {
    const result = calculateNotaCalc(base)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(10)
  })

  it("sem platformAvg usa apenas gptNormalized no blend", () => {
    const result = calculateNotaCalc({ ...base, platformAvg: null, totalVotes: 0 })
    // blend = gptNormalized puro
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(10)
  })

  it("status Hiatus (H) tem penalidade maior que Completed (C)", () => {
    const resC = calculateNotaCalc({ ...base, publicationStatus: "C" })
    const resH = calculateNotaCalc({ ...base, publicationStatus: "H" })
    expect(resC).toBeGreaterThan(resH)
  })

  it("sinopse ♥♥♥♥ > ♥♥♥ > ♥♥ > ♥", () => {
    const r4 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥♥♥" })
    const r3 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥♥" })
    const r2 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥" })
    const r1 = calculateNotaCalc({ ...base, synopsisQuality: "♥" })
    expect(r4).toBeGreaterThan(r3)
    expect(r3).toBeGreaterThan(r2)
    expect(r2).toBeGreaterThan(r1)
  })

  it("observationPenalty=0.30 reduz nota em 30%", () => {
    const resZero = calculateNotaCalc({ ...base, observationPenalty: 0 })
    const res30 = calculateNotaCalc({ ...base, observationPenalty: 0.30 })
    expect(res30).toBeCloseTo(resZero * 0.70 * (1 + base.chaptersNormalized / 200) / (1 + base.chaptersNormalized / 200), 0)
  })

  it("penalidade acima de 0.30 é clamped a 0.30", () => {
    const res30 = calculateNotaCalc({ ...base, observationPenalty: 0.30 })
    const res50 = calculateNotaCalc({ ...base, observationPenalty: 0.50 })
    expect(res30).toBeCloseTo(res50, 4)
  })
})

describe("calculateNotaFinal", () => {
  it("com MAEs iguais, retorna média simples", () => {
    const result = calculateNotaFinal(7.0, 9.0, 1.0, 1.0)
    expect(result).toBeCloseTo(8.0, 4)
  })

  it("MAE menor tem peso maior", () => {
    // MAE_pr menor → Nota.Pr tem mais peso
    const result = calculateNotaFinal(7.0, 9.0, 1.27, 0.92)
    expect(result).toBeGreaterThan(8.0)
  })

  it("resultado clamped a 0–10", () => {
    expect(calculateNotaFinal(0, 0, 1, 1)).toBe(0)
    expect(calculateNotaFinal(10, 10, 1, 1)).toBe(10)
  })
})
