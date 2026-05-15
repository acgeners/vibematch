import { describe, it, expect } from "vitest"
import { calculateGPT, normalizeGPT, calculateGPTWithDiagnostics } from "@/lib/calculations/gpt"
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

  it("critério positivo acima do threshold ganha bônus de 0.5× o excesso", () => {
    // Romance threshold=8, weight=10. Score=10 → 10*10 + 0.5*(10-8)*10 = 110.
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
    // numerador = (10*10 + 0.5*2*10) + 8 * (9+6+8+6+10+7) = 110 + 368 = 478
    // positiveSum = 56 → GPT = 478/56 ≈ 8.536
    const result = calculateGPT(scores, weights)
    expect(result).toBeCloseTo(478 / 56, 3)
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

describe("calculateGPTWithDiagnostics", () => {
  it("sinaliza clamp quando o resultado pré-clamp passa de 10", () => {
    // Forçar excedente alto + threshold baixo → numerador > 10*denominator.
    const weights = baseWeights.map((w) =>
      w.weight > 0 ? { ...w, threshold: 0 } : { ...w, threshold: 10 }
    )
    const scores: CategoryScoreMap = {
      romance: 10, couple_dynamics: 10, fantasy_nobility: 10,
      action_adventure: 10, adult_content: 10, protagonist: 10,
      humor: 10, drama: 0, tragedy: 0,
    }
    const { value, diagnostics } = calculateGPTWithDiagnostics(scores, weights)
    expect(value).toBe(10)
    expect(diagnostics.clampHit).toBe(true)
    expect(diagnostics.rawValue).toBeGreaterThan(10)
  })

  it("sinaliza ativação de critério negativo quando score > threshold", () => {
    const scores: CategoryScoreMap = {
      romance: 5, couple_dynamics: 5, fantasy_nobility: 5,
      action_adventure: 5, adult_content: 5, protagonist: 5,
      humor: 5, drama: 8, tragedy: 1,
    }
    const { diagnostics } = calculateGPTWithDiagnostics(scores, baseWeights)
    expect(diagnostics.negativeActivations.drama).toBe(true)
    expect(diagnostics.negativeActivations.tragedy).toBe(false)
  })
})

describe("normalizeGPT", () => {
  it("GPT=mean → GPT.N=5 (ponto neutro)", () => {
    expect(normalizeGPT(7.2, 7.2, 1.0)).toBe(5)
  })

  it("z-score positivo: GPT 1σ acima da média → 5 + 1.5", () => {
    expect(normalizeGPT(8.2, 7.2, 1.0)).toBeCloseTo(6.5, 4)
  })

  it("z-score negativo: GPT 1σ abaixo → 5 - 1.5", () => {
    expect(normalizeGPT(6.2, 7.2, 1.0)).toBeCloseTo(3.5, 4)
  })

  it("clamp inferior em 0 quando z muito negativo", () => {
    expect(normalizeGPT(0, 7.2, 1.0)).toBe(0)
  })

  it("clamp superior em 10 quando z muito positivo", () => {
    expect(normalizeGPT(15, 7.2, 1.0)).toBe(10)
  })

  it("std inválido (≤0) cai pra default 4", () => {
    // mean=5, std=0 (inválido) → std efetivo = 4
    // GPT=5 → 5 + 0/4 * 1.5 = 5
    expect(normalizeGPT(5, 5, 0)).toBe(5)
  })

  it("defaults (mean=5, std=4): GPT=5 ainda mapeia pra 5", () => {
    expect(normalizeGPT(5)).toBe(5)
  })
})
