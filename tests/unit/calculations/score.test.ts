import { describe, it, expect } from "vitest"
import { calculateNotaCalc } from "@/lib/calculations/score"

describe("calculateNotaCalc", () => {
  const base = {
    iaEvalNormalized: 7.5,
    platformAvg: 8.0,
    totalVotes: 1000,
    synopsisQuality: "♥♥♥" as const,
    observationAdjustment: 0,
    pseudoVotesBlend: 1024,
  }

  it("retorna valor entre 0 e 10", () => {
    const result = calculateNotaCalc(base)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(10)
  })

  it("sem platformAvg usa apenas iaEvalNormalized no blend", () => {
    const result = calculateNotaCalc({ ...base, platformAvg: null, totalVotes: 0 })
    // blend = iaEvalNormalized puro
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(10)
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

  it("saltos do interesse de sinopse são progressivos (côncavo-pra-cima)", () => {
    const r4 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥♥♥" })
    const r3 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥♥" })
    const r2 = calculateNotaCalc({ ...base, synopsisQuality: "♥♥" })
    const r1 = calculateNotaCalc({ ...base, synopsisQuality: "♥" })
    expect(r4 - r3).toBeGreaterThan(r3 - r2)
    expect(r3 - r2).toBeGreaterThan(r2 - r1)
  })

  it("observationAdjustment=-0.30 reduz nota em 0.30 ponto", () => {
    const resZero = calculateNotaCalc({ ...base, observationAdjustment: 0 })
    const resNeg = calculateNotaCalc({ ...base, observationAdjustment: -0.30 })
    expect(resNeg).toBeCloseTo(Math.max(0, resZero - 0.30), 4)
  })

  it("observationAdjustment=+0.20 aumenta nota em 0.20 ponto", () => {
    const resZero = calculateNotaCalc({ ...base, observationAdjustment: 0 })
    const resPos = calculateNotaCalc({ ...base, observationAdjustment: 0.20 })
    expect(resPos).toBeCloseTo(Math.min(10, resZero + 0.20), 4)
  })

  it("ajuste fora de [-0.30, +0.30] é clamped nos limites", () => {
    const resMin = calculateNotaCalc({ ...base, observationAdjustment: -0.30 })
    const resBelow = calculateNotaCalc({ ...base, observationAdjustment: -0.50 })
    expect(resMin).toBeCloseTo(resBelow, 4)

    const resMax = calculateNotaCalc({ ...base, observationAdjustment: 0.30 })
    const resAbove = calculateNotaCalc({ ...base, observationAdjustment: 0.50 })
    expect(resMax).toBeCloseTo(resAbove, 4)
  })
})
