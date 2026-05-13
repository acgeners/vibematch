import { describe, it, expect } from "vitest"
import { calculateGPT, normalizeGPT } from "@/lib/calculations/gpt"
import type { ScoreWeight, CategoryScoreMap } from "@/types/domain"

const baseWeights: ScoreWeight[] = [
  { id: "1", slug: "romance", name: "Romance", weight: 10, max_negative_threshold: null, display_order: 1, is_active: true },
  { id: "2", slug: "couple_dynamics", name: "Dinâmica", weight: 9, max_negative_threshold: null, display_order: 2, is_active: true },
  { id: "3", slug: "fantasy_nobility", name: "Fantasia", weight: 6, max_negative_threshold: null, display_order: 3, is_active: true },
  { id: "4", slug: "action_adventure", name: "Ação", weight: 8, max_negative_threshold: null, display_order: 4, is_active: true },
  { id: "5", slug: "adult_content", name: "Adulto", weight: 6, max_negative_threshold: null, display_order: 5, is_active: true },
  { id: "6", slug: "protagonist", name: "Protagonista", weight: 10, max_negative_threshold: null, display_order: 6, is_active: true },
  { id: "7", slug: "humor", name: "Humor", weight: 7, max_negative_threshold: null, display_order: 7, is_active: true },
  { id: "8", slug: "drama", name: "Drama", weight: -4, max_negative_threshold: 5, display_order: 8, is_active: true },
  { id: "9", slug: "tragedy", name: "Tragédia", weight: -10, max_negative_threshold: 3, display_order: 9, is_active: true },
]

describe("calculateGPT", () => {
  it("retorna 0 para scores todos zero", () => {
    const scores: CategoryScoreMap = {}
    expect(calculateGPT(scores, baseWeights)).toBe(0)
  })

  it("calcula corretamente sem penalidades (drama/tragédia abaixo do threshold)", () => {
    // drama=3 (threshold=5, sem penalidade), tragedy=2 (threshold=3, sem penalidade)
    const scores: CategoryScoreMap = {
      romance: 8, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 3, tragedy: 2,
    }
    // numerador = 8*10 + 8*9 + 8*6 + 8*8 + 8*6 + 8*10 + 8*7 + 0 + 0
    // = 8 * (10+9+6+8+6+10+7) = 8 * 56 = 448
    // positiveSum = 56
    // GPT = 448/56 = 8
    expect(calculateGPT(scores, baseWeights)).toBe(8)
  })

  it("aplica penalidade de drama acima do threshold", () => {
    const scores: CategoryScoreMap = {
      romance: 8, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 7, tragedy: 2, // drama=7, excess=7-5=2, penalty=2*(-4)=-8
    }
    // numerador = 8*56 - 2*4 = 448 - 8 = 440
    // GPT = 440/56 ≈ 7.857
    const result = calculateGPT(scores, baseWeights)
    expect(result).toBeCloseTo(440 / 56, 3)
  })

  it("aplica penalidade de tragédia acima do threshold", () => {
    const scores: CategoryScoreMap = {
      romance: 8, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 3, tragedy: 8, // tragedy=8, excess=8-3=5, penalty=5*(-10)=-50
    }
    const result = calculateGPT(scores, baseWeights)
    // numerador = 448 - 50 = 398
    expect(result).toBeCloseTo(398 / 56, 3)
  })

  it("clamp: resultado não ultrapassa 0–10", () => {
    const scores: CategoryScoreMap = {
      romance: 10, couple_dynamics: 10, fantasy_nobility: 10,
      action_adventure: 10, adult_content: 10, protagonist: 10,
      humor: 10, drama: 0, tragedy: 0,
    }
    expect(calculateGPT(scores, baseWeights)).toBeLessThanOrEqual(10)
    expect(calculateGPT(scores, baseWeights)).toBeGreaterThanOrEqual(0)
  })

  it("ignora critérios inativos", () => {
    const weightsComInativo = baseWeights.map((w) =>
      w.slug === "romance" ? { ...w, is_active: false } : w
    )
    const scores: CategoryScoreMap = { romance: 10 }
    // romance inativo não contribui nem para numerador nem denominador
    const result = calculateGPT(scores, weightsComInativo)
    expect(result).toBe(0)
  })
})

describe("normalizeGPT", () => {
  it("GPT=5 → GPT.N=5 (ponto neutro)", () => {
    expect(normalizeGPT(5)).toBe(5)
  })

  it("GPT=8 → GPT.N=8.75", () => {
    expect(normalizeGPT(8)).toBeCloseTo(5 + (8 - 5) * 1.25)
  })

  it("GPT=0 → GPT.N=0 (clamp inferior)", () => {
    expect(normalizeGPT(0)).toBe(0)
  })

  it("GPT=10 → GPT.N=11.25 clamped a 10", () => {
    expect(normalizeGPT(10)).toBe(10)
  })
})
