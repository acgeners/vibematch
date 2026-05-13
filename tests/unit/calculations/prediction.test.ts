import { describe, it, expect } from "vitest"
import { trainPredictor, type PredictionInput } from "@/lib/calculations/prediction"

const baseInput = (overrides: Partial<PredictionInput> = {}): PredictionInput => ({
  categoryScores: {
    romance: 8,
    couple_dynamics: 7,
    fantasy_nobility: 6,
    action_adventure: 5,
    adult_content: 0,
    protagonist: 8,
    humor: 6,
    drama: 4,
    tragedy: 2,
  },
  gptNormalized: 7.5,
  platformAvg: 8.0,
  totalVotes: 1500,
  totalChapters: 120,
  synopsisQuality: "♥♥♥",
  observationPenalty: 0,
  publicationStatus: "C",
  ...overrides,
})

describe("trainPredictor", () => {
  it("falls back to mean when training data is too small", () => {
    const inputs = Array.from({ length: 5 }, () => baseInput())
    const targets = [7, 8, 9, 6, 7]
    const predictor = trainPredictor(inputs, targets)
    expect(predictor.isStub).toBe(true)
    const preds = predictor.predict([baseInput()])
    expect(preds[0]).toBeCloseTo(7.4, 1) // mean of targets
  })

  it("trains a real Ridge model with ≥ 20 samples", () => {
    const inputs: PredictionInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 30; i++) {
      const romance = (i % 10) + 1
      inputs.push(
        baseInput({
          categoryScores: {
            romance,
            couple_dynamics: 5,
            fantasy_nobility: 5,
            action_adventure: 5,
            adult_content: 0,
            protagonist: 6,
            humor: 5,
            drama: 4,
            tragedy: 2,
          },
        })
      )
      // y depende fortemente de romance
      targets.push(0.5 * romance + 4 + (i % 3) * 0.1)
    }
    const predictor = trainPredictor(inputs, targets)
    expect(predictor.isStub).toBe(false)
    expect(predictor.trainSize).toBe(30)
    expect(predictor.model.cvMAE).toBeLessThan(2)
    expect(predictor.featureNames.length).toBeGreaterThan(10)
    const preds = predictor.predict(inputs.slice(0, 5))
    for (const p of preds) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(10)
    }
  })

  it("handles missing values via median imputation", () => {
    const inputs: PredictionInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 25; i++) {
      inputs.push(
        baseInput({
          // sem categoria romance — vira null
          categoryScores: { drama: 4, tragedy: 2 },
          totalChapters: i % 3 === 0 ? null : 100,
          platformAvg: i % 4 === 0 ? null : 7.5,
        })
      )
      targets.push(7 + (i % 5) * 0.2)
    }
    const predictor = trainPredictor(inputs, targets)
    expect(predictor.isStub).toBe(false)
    // Não deve quebrar com valores faltantes
    const preds = predictor.predict([baseInput({ categoryScores: {}, totalChapters: null })])
    expect(preds[0]).toBeGreaterThan(0)
    expect(preds[0]).toBeLessThan(10)
  })
})
