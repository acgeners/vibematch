import { describe, it, expect } from "vitest"
import { computeCalibration } from "@/lib/calculations/calibration"

describe("computeCalibration", () => {
  it("returns null MAE/RMSE when there is no manual_score data", () => {
    const cal = computeCalibration([
      { workId: "a", manualScore: null, calcScore: 7, predictedScore: 8, finalScore: 7.5, totalVotes: 100 },
    ])
    expect(cal.trainSize).toBe(0)
    expect(cal.maeCalc).toBeNull()
    expect(cal.maePredicted).toBeNull()
    expect(cal.rmseCalc).toBeNull()
    expect(cal.rmsePredicted).toBeNull()
  })

  it("returns null MAE/RMSE when train size is below MIN_TRAIN_FOR_MAE (20)", () => {
    const items = []
    for (let i = 0; i < 10; i++) {
      items.push({
        workId: `w${i}`,
        manualScore: 8.0,
        calcScore: 7.0,
        predictedScore: 7.5,
        finalScore: 7.3,
        totalVotes: (i + 1) * 100,
      })
    }
    const cal = computeCalibration(items)
    expect(cal.trainSize).toBe(10)
    expect(cal.maeCalc).toBeNull()
    expect(cal.rmseCalc).toBeNull()
  })

  it("computes real MAE and RMSE when enough data is present", () => {
    const items = []
    for (let i = 0; i < 20; i++) {
      items.push({
        workId: `w${i}`,
        manualScore: 8.0,
        calcScore: 7.0, // signed diff = -1, abs = 1
        predictedScore: 7.5, // diff = -0.5
        finalScore: 7.3, // diff = -0.7
        totalVotes: (i + 1) * 100,
      })
    }
    const cal = computeCalibration(items)
    expect(cal.trainSize).toBe(20)
    expect(cal.maeCalc).toBeCloseTo(1.0, 3)
    expect(cal.maePredicted).toBeCloseTo(0.5, 3)
    expect(cal.maeFinal).toBeCloseTo(0.7, 3)
    // RMSE = sqrt(mean(diff²)). Com resíduos constantes, RMSE == |diff|.
    expect(cal.rmseCalc).toBeCloseTo(1.0, 3)
    expect(cal.rmsePredicted).toBeCloseTo(0.5, 3)
    expect(cal.rmseFinal).toBeCloseTo(0.7, 3)
  })

  it("pseudo_votes derivam da mediana com multiplicador (não mais P75/P60)", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      workId: `w${i}`,
      manualScore: null,
      calcScore: null,
      predictedScore: null,
      finalScore: null,
      totalVotes: i + 1, // 1..100
    }))
    const cal = computeCalibration(items)
    // Mediana de [1..100] ≈ 50.5. NotaM = 50.5 × 2.0 ≈ 101; Blend = 50.5 × 1.2 ≈ 60.6.
    expect(cal.pseudoVotesNotaM).toBeGreaterThan(95)
    expect(cal.pseudoVotesNotaM).toBeLessThan(110)
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
