import { describe, it, expect } from "vitest"
import { computeBiasForSlug, BIAS_SHRINKAGE_K } from "@/lib/calculations/attribute-bias"
import {
  applyBiasToCategoryScores,
  type CategoryScoreWithSource,
} from "@/lib/ai-recommendation/calibrated-scores"
import type { CriterionSlug } from "@/types/domain"

describe("computeBiasForSlug", () => {
  it("returns zeros and null stddev with no samples", () => {
    const b = computeBiasForSlug("drama", [])
    expect(b.nSamples).toBe(0)
    expect(b.meanBiasRaw).toBe(0)
    expect(b.biasApplied).toBe(0)
    expect(b.stddev).toBeNull()
  })

  it("stddev is null with a single sample", () => {
    const b = computeBiasForSlug("drama", [2])
    expect(b.nSamples).toBe(1)
    expect(b.meanBiasRaw).toBe(2)
    expect(b.stddev).toBeNull()
  })

  it("applies 50% shrinkage at n=10 (mean=2 → 1.0)", () => {
    const deltas = Array.from({ length: 10 }, () => 2)
    const b = computeBiasForSlug("drama", deltas)
    expect(b.nSamples).toBe(10)
    expect(b.meanBiasRaw).toBeCloseTo(2, 6)
    // 2 × 10/(10+10) = 1.0
    expect(b.biasApplied).toBeCloseTo(1.0, 6)
  })

  it("applies ~83% shrinkage at n=50 (mean=2 → ~1.667)", () => {
    const deltas = Array.from({ length: 50 }, () => 2)
    const b = computeBiasForSlug("drama", deltas)
    // 2 × 50/(50+10) = 1.6667
    expect(b.biasApplied).toBeCloseTo(2 * (50 / (50 + BIAS_SHRINKAGE_K)), 6)
  })

  it("computes mean as ia - user (positive = IA overestimates)", () => {
    // IA disse 8, user disse 6 → delta +2 (IA superestima)
    const b = computeBiasForSlug("drama", [8 - 6])
    expect(b.meanBiasRaw).toBe(2)
  })

  it("computes a finite stddev with >=2 samples", () => {
    const b = computeBiasForSlug("drama", [1, 3])
    expect(b.stddev).not.toBeNull()
    // sample stddev of [1,3] = sqrt(2) ≈ 1.414
    expect(b.stddev!).toBeCloseTo(Math.SQRT2, 6)
  })
})

describe("applyBiasToCategoryScores", () => {
  const biasMap = { drama: 1, romance: -0.5 }

  function entry(value: number, source: CategoryScoreWithSource["source"]): CategoryScoreWithSource {
    return { value, source }
  }

  it("applies bias to ai_accepted and ai_calibrated", () => {
    const raw: Partial<Record<CriterionSlug, CategoryScoreWithSource>> = {
      drama: entry(8, "ai_accepted"),
      romance: entry(5, "ai_calibrated"),
    }
    const out = applyBiasToCategoryScores(raw, biasMap)
    expect(out.drama).toBeCloseTo(7, 6) // 8 - 1
    expect(out.romance).toBeCloseTo(5.5, 6) // 5 - (-0.5)
  })

  it("skips manual, ai_edited and imported (passes value through)", () => {
    const raw: Partial<Record<CriterionSlug, CategoryScoreWithSource>> = {
      drama: entry(8, "ai_edited"),
      romance: entry(5, "manual"),
      humor: entry(6, "imported"),
    }
    const out = applyBiasToCategoryScores(raw, { drama: 1, romance: -0.5, humor: 2 })
    expect(out.drama).toBe(8)
    expect(out.romance).toBe(5)
    expect(out.humor).toBe(6)
  })

  it("returns null for absent slugs", () => {
    const out = applyBiasToCategoryScores({ drama: entry(8, "ai_accepted") }, biasMap)
    expect(out.drama).toBeCloseTo(7, 6)
    expect(out.tragedy).toBeNull()
    expect(out.humor).toBeNull()
  })

  it("treats missing bias entry as zero", () => {
    const out = applyBiasToCategoryScores({ tragedy: entry(4, "ai_accepted") }, {})
    expect(out.tragedy).toBe(4)
  })

  it("empty biasMap is the identity for every source (pipeline regression guard)", () => {
    // O pipeline (Ridge/personalFit/prompts) calibra on-read. Quando não há
    // bias coletado o comportamento tem que ser IDÊNTICO ao pré-1.5.3.
    const raw: Partial<Record<CriterionSlug, CategoryScoreWithSource>> = {
      romance: entry(7.5, "ai_accepted"),
      drama: entry(8, "ai_edited"),
      humor: entry(6, "manual"),
      tragedy: entry(4, "ai_calibrated"),
      action_adventure: entry(5.5, "imported"),
    }
    const out = applyBiasToCategoryScores(raw, {})
    expect(out.romance).toBe(7.5)
    expect(out.drama).toBe(8)
    expect(out.humor).toBe(6)
    expect(out.tragedy).toBe(4)
    expect(out.action_adventure).toBe(5.5)
  })
})
