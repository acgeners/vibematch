import { describe, it, expect } from "vitest"
import {
  trainExpectedPredictor,
  verifyDecompositionCovers,
  EXPECTED_BASELINE_FEATURES,
  EXPECTED_QUALITY_FEATURES,
  EXPECTED_NUMERIC_FEATURES,
  POST_SCORE_FIELDS,
  type ExpectedScoreInput,
  type PostScoreField,
} from "@/lib/calculations/expected"

const baseInput = (overrides: Partial<ExpectedScoreInput> = {}): ExpectedScoreInput => ({
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
  iaEvalNormalized: 7.5,
  platformAvg: 8.0,
  totalVotes: 1500,
  totalChapters: 120,
  synopsisQuality: "♥♥♥",
  observationAdjustment: 0,
  publicationStatus: "Completed",
  lovedTagOverlap: null,
  avoidedTagOverlap: null,
  criterionFitScore: null,
  postScores: {},
  ...overrides,
})

const allPostScores = (value = 7): Partial<Record<PostScoreField, number>> => {
  const obj: Partial<Record<PostScoreField, number>> = {}
  for (const f of POST_SCORE_FIELDS) obj[f] = value
  return obj
}

describe("trainExpectedPredictor (single Ridge + decomposition)", () => {
  it("falls back to mean when training data is too small", () => {
    const inputs = Array.from({ length: 5 }, () => baseInput())
    const targets = [7, 8, 9, 6, 7]
    const predictor = trainExpectedPredictor(inputs, targets)
    expect(predictor.isStub).toBe(true)
    const preds = predictor.predict([baseInput()])
    expect(preds[0].expected).toBeCloseTo(7.4, 1)
    expect(preds[0].baseline).toBeCloseTo(7.4, 1)
    expect(preds[0].qualityAdj).toBe(0)
  })

  it("trains single Ridge with 14 baseline features + status one-hot (post_* removidos)", () => {
    const inputs: ExpectedScoreInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 30; i++) {
      const romance = (i % 10) + 1
      const quality = 5 + (i % 5)
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
          iaEvalNormalized: 5 + (romance - 5) * 0.5,
          postScores: allPostScores(quality),
        }),
      )
      targets.push(0.5 * romance + 4 + (quality - 5) * 0.3)
    }
    const predictor = trainExpectedPredictor(inputs, targets)
    expect(predictor.isStub).toBe(false)
    expect(predictor.trainSize).toBe(30)
    // trainWithPostScores ainda conta inputs com post_scores presente (informativo);
    // mas eles não viram features do Ridge.
    expect(predictor.trainWithPostScores).toBe(30)

    expect(predictor.featureNames).toContain("romance")
    expect(predictor.featureNames).toContain("IA(n)")
    expect(predictor.featureNames).toContain("Nota.M")
    expect(predictor.featureNames).toContain("CriterionFitScore")
    // post_* features REMOVIDAS do Ridge (mantidas no input pra back-compat)
    expect(predictor.featureNames).not.toContain("post_story_score")
    expect(predictor.featureNames).not.toContain("post_originality_score")
    expect(predictor.featureNames).not.toContain("MeanPostScore")

    // Cobertura completa: baselineIndices + qualityIndices cobrem todos
    expect(verifyDecompositionCovers(predictor)).toBe(true)

    // 14 baseline numéricas + N status one-hot (≥ 15 com pelo menos 1 status)
    expect(predictor.baselineIndices.length).toBeGreaterThanOrEqual(14)
    // 0 quality numéricas após revisão
    expect(predictor.qualityIndices.length).toBe(0)

    const preds = predictor.predict(inputs.slice(0, 5))
    for (const p of preds) {
      expect(p.expected).toBeGreaterThanOrEqual(0)
      expect(p.expected).toBeLessThanOrEqual(10)
      // qualityAdj é sempre 0 sem features quality
      expect(p.qualityAdj).toBe(0)
    }
  })

  it("decomposition: baseline + qualityAdj ≈ expected (pré-clamp)", () => {
    const inputs: ExpectedScoreInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 25; i++) {
      inputs.push(
        baseInput({
          iaEvalNormalized: 6 + (i % 4) * 0.5,
          postScores: allPostScores(6 + (i % 4)),
        }),
      )
      targets.push(7 + (i % 5) * 0.2)
    }
    const predictor = trainExpectedPredictor(inputs, targets)

    const preds = predictor.predict(inputs.slice(0, 5))
    for (const p of preds) {
      // baseline + qualityAdj == expected (quando dentro de [0, 10]; clamp aplica só nos extremos)
      const sum = p.baseline + p.qualityAdj
      const clamped = Math.max(0, Math.min(10, sum))
      expect(Math.abs(p.expected - clamped)).toBeLessThan(0.001)
    }
  })

  it("qualityAdj is always 0 for unread obras (post_* removidos do Ridge)", () => {
    const inputs: ExpectedScoreInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 25; i++) {
      inputs.push(
        baseInput({
          iaEvalNormalized: 6 + (i % 5),
          postScores: allPostScores(6 + (i % 4)),
        }),
      )
      targets.push(7 + (i % 5) * 0.2)
    }
    const predictor = trainExpectedPredictor(inputs, targets)

    const unreadPred = predictor.predict([
      baseInput({ iaEvalNormalized: 7.0, postScores: {} }),
    ])[0]

    // Flag legacy ainda computada a partir do input (não do Ridge):
    // hasAnyPostScore({}) === false → flag true.
    expect(unreadPred.qualityAdjFromImputation).toBe(true)
    // qualityAdj é 0 exato — não há features quality contribuindo no Ridge.
    expect(unreadPred.qualityAdj).toBe(0)
    expect(unreadPred.expected).toBeGreaterThanOrEqual(0)
    expect(unreadPred.expected).toBeLessThanOrEqual(10)
  })

  it("handles missing values via median imputation across both groups", () => {
    const inputs: ExpectedScoreInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 25; i++) {
      inputs.push(
        baseInput({
          categoryScores: { drama: 4, tragedy: 2 },
          totalChapters: i % 3 === 0 ? null : 100,
          platformAvg: i % 4 === 0 ? null : 7.5,
          iaEvalNormalized: i % 5 === 0 ? null : 7.0,
          postScores: i % 2 === 0 ? allPostScores(6 + (i % 3)) : {},
        }),
      )
      targets.push(7 + (i % 5) * 0.2)
    }
    const predictor = trainExpectedPredictor(inputs, targets)
    expect(predictor.isStub).toBe(false)
    const preds = predictor.predict([
      baseInput({ categoryScores: {}, totalChapters: null, iaEvalNormalized: null, postScores: {} }),
    ])
    expect(preds[0].expected).toBeGreaterThan(0)
    expect(preds[0].expected).toBeLessThan(10)
  })

  it("predictWithDistance returns euclidean distance to centroid", () => {
    const inputs: ExpectedScoreInput[] = []
    const targets: number[] = []
    for (let i = 0; i < 25; i++) {
      inputs.push(baseInput({ totalVotes: 1000 + i * 10, postScores: allPostScores(7) }))
      targets.push(7 + (i % 4) * 0.3)
    }
    const predictor = trainExpectedPredictor(inputs, targets)

    const close = predictor.predictWithDistance([baseInput({ totalVotes: 1125 })])
    expect(close.distances[0]).toBeGreaterThanOrEqual(0)

    const far = predictor.predictWithDistance([
      baseInput({
        totalVotes: 999999,
        platformAvg: 2.0,
        synopsisQuality: "♥",
        publicationStatus: "Hiatus",
        iaEvalNormalized: 1.0,
      }),
    ])
    expect(far.distances[0]).toBeGreaterThan(close.distances[0])
  })

  it("declares feature lists in expected order (quality vazio após revisão)", () => {
    expect(EXPECTED_BASELINE_FEATURES).toEqual([
      "romance",
      "couple_dynamics",
      "fantasy_nobility",
      "action_adventure",
      "adult_content",
      "protagonist",
      "humor",
      "drama",
      "tragedy",
      "IA(n)",
      "Nota.M",
      "LogVotos",
      "Cps.N",
      "SinopseScore",
      "ObsAdjustment",
      "LovedTagOverlap",
      "AvoidedTagOverlap",
      "CriterionFitScore",
    ])
    // QUALITY removida do Ridge — array vazio. POST_SCORE_FIELDS preservado
    // pra back-compat de outros módulos que ainda consomem o nome.
    expect(EXPECTED_QUALITY_FEATURES).toEqual([])
    expect(POST_SCORE_FIELDS).toHaveLength(8)
    expect(EXPECTED_NUMERIC_FEATURES).toEqual(EXPECTED_BASELINE_FEATURES)
  })
})
