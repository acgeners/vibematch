import { describe, it, expect } from "vitest"
import { calculateGPT, normalizeGPT } from "@/lib/calculations/gpt"
import type { ScoreWeight, CategoryScoreMap } from "@/types/domain"

const baseWeights: ScoreWeight[] = [
  { id: "1", slug: "romance", name: "Romance", weight: 10, threshold: null, display_order: 1, is_active: true },
  { id: "2", slug: "couple_dynamics", name: "Dinâmica", weight: 9, threshold: null, display_order: 2, is_active: true },
  { id: "3", slug: "fantasy_nobility", name: "Fantasia", weight: 6, threshold: null, display_order: 3, is_active: true },
  { id: "4", slug: "action_adventure", name: "Ação", weight: 8, threshold: null, display_order: 4, is_active: true },
  { id: "5", slug: "adult_content", name: "Adulto", weight: 6, threshold: null, display_order: 5, is_active: true },
  { id: "6", slug: "protagonist", name: "Protagonista", weight: 10, threshold: null, display_order: 6, is_active: true },
  { id: "7", slug: "humor", name: "Humor", weight: 7, threshold: null, display_order: 7, is_active: true },
  { id: "8", slug: "drama", name: "Drama", weight: -4, threshold: 5, display_order: 8, is_active: true },
  { id: "9", slug: "tragedy", name: "Tragédia", weight: -10, threshold: 3, display_order: 9, is_active: true },
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
    // Todos os positivos têm threshold null (= 0): cada ponto acima de 0 conta dobrado.
    // contribuição positiva = score * w + (score - 0) * w = 2 * score * w
    // numerador = 2 * 8 * 56 = 896
    // positiveSum = 56 → GPT = 896/56 = 16 → clamp = 10
    expect(calculateGPT(scores, baseWeights)).toBe(10)
  })

  it("critério positivo abaixo do threshold contribui só com a base", () => {
    // Romance com threshold 9, score 7: contribuição = 7 * 10 = 70 (sem bônus)
    const weights = baseWeights.map((w) =>
      w.slug === "romance"
        ? { ...w, threshold: 9 }
        : { ...w, threshold: 10 } // demais positivos: threshold no topo => nunca há bônus
    )
    const scores: CategoryScoreMap = {
      romance: 7, couple_dynamics: 7, fantasy_nobility: 7,
      action_adventure: 7, adult_content: 7, protagonist: 7,
      humor: 7, drama: 3, tragedy: 2,
    }
    // numerador = 7 * 56 = 392; positiveSum = 56 → GPT = 7
    expect(calculateGPT(scores, weights)).toBeCloseTo(7, 3)
  })

  it("critério positivo acima do threshold ganha bônus dobrado", () => {
    // Romance threshold=8, weight=10. Score=10 → 10*10 + (10-8)*10 = 120.
    // Demais positivos com threshold=10 (sem bônus).
    const weights = baseWeights.map((w) => {
      if (w.weight < 0) return w
      if (w.slug === "romance") return { ...w, threshold: 8 }
      return { ...w, threshold: 10 }
    })
    const scores: CategoryScoreMap = {
      romance: 10, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 3, tragedy: 2,
    }
    // numerador = (10*10 + 2*10) + 8 * (9+6+8+6+10+7) = 120 + 8*46 = 120 + 368 = 488
    // positiveSum = 56 → GPT = 488/56 ≈ 8.714
    const result = calculateGPT(scores, weights)
    expect(result).toBeCloseTo(488 / 56, 3)
  })

  it("aplica penalidade de drama acima do threshold (negativo)", () => {
    const weights = baseWeights.map((w) =>
      w.weight > 0 ? { ...w, threshold: 10 } : w // remove bônus dos positivos para isolar a penalidade
    )
    const scores: CategoryScoreMap = {
      romance: 8, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 7, tragedy: 2, // drama=7, excess=7-5=2, penalty=2*(-4)=-8
    }
    // numerador = 8*56 - 8 = 440
    const result = calculateGPT(scores, weights)
    expect(result).toBeCloseTo(440 / 56, 3)
  })

  it("aplica penalidade de tragédia acima do threshold (negativo)", () => {
    const weights = baseWeights.map((w) =>
      w.weight > 0 ? { ...w, threshold: 10 } : w
    )
    const scores: CategoryScoreMap = {
      romance: 8, couple_dynamics: 8, fantasy_nobility: 8,
      action_adventure: 8, adult_content: 8, protagonist: 8,
      humor: 8, drama: 3, tragedy: 8, // tragedy=8, excess=8-3=5, penalty=5*(-10)=-50
    }
    const result = calculateGPT(scores, weights)
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
