import { describe, it, expect } from "vitest"
import { computeCalibration } from "@/lib/calculations/calibration"

describe("computeCalibration", () => {
  it("returns fallback values when there is no manual_score data", () => {
    const cal = computeCalibration([
      { workId: "a", manualScore: null, calcScore: 7, predictedScore: 8, finalScore: 7.5, totalVotes: 100 },
    ])
    expect(cal.trainSize).toBe(0)
    expect(cal.maeCalc).toBeCloseTo(1.2657, 3)
    expect(cal.maePredicted).toBeCloseTo(0.9246, 3)
  })

  it("computes real MAE when enough data is present", () => {
    const items = []
    for (let i = 0; i < 10; i++) {
      items.push({
        workId: `w${i}`,
        manualScore: 8.0,
        calcScore: 7.0, // diff = 1
        predictedScore: 7.5, // diff = 0.5
        finalScore: 7.3, // diff = 0.7
        totalVotes: (i + 1) * 100,
      })
    }
    const cal = computeCalibration(items)
    expect(cal.trainSize).toBe(10)
    expect(cal.maeCalc).toBeCloseTo(1.0, 3)
    expect(cal.maePredicted).toBeCloseTo(0.5, 3)
    expect(cal.maeFinal).toBeCloseTo(0.7, 3)
  })

  it("computes percentile of vote counts", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      workId: `w${i}`,
      manualScore: null,
      calcScore: null,
      predictedScore: null,
      finalScore: null,
      totalVotes: i + 1, // 1..100
    }))
    const cal = computeCalibration(items)
    // Percentile 75 of [1..100] ≈ 75.25
    expect(cal.pseudoVotesNotaM).toBeGreaterThan(70)
    expect(cal.pseudoVotesNotaM).toBeLessThan(80)
    expect(cal.pseudoVotesBlend).toBeGreaterThan(55)
    expect(cal.pseudoVotesBlend).toBeLessThan(65)
  })

  it("returns top worst diffs sorted by diffFinal", () => {
    const items = [
      { workId: "good", manualScore: 8, calcScore: 8, predictedScore: 8, finalScore: 8, totalVotes: 0 },
      { workId: "ok", manualScore: 8, calcScore: 7.5, predictedScore: 7.5, finalScore: 7.5, totalVotes: 0 },
      { workId: "bad", manualScore: 8, calcScore: 5, predictedScore: 5, finalScore: 5, totalVotes: 0 },
      { workId: "worst", manualScore: 8, calcScore: 3, predictedScore: 3, finalScore: 3, totalVotes: 0 },
      { workId: "x1", manualScore: 8, calcScore: 7.9, predictedScore: 7.9, finalScore: 7.9, totalVotes: 0 },
      { workId: "x2", manualScore: 8, calcScore: 7.8, predictedScore: 7.8, finalScore: 7.8, totalVotes: 0 },
    ]
    const cal = computeCalibration(items)
    expect(cal.worstDiffs[0].workId).toBe("worst")
    expect(cal.worstDiffs[1].workId).toBe("bad")
  })
})
