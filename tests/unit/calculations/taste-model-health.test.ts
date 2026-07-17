import { describe, it, expect } from "vitest"
import {
  computeTasteModelHealth,
  flagsForCriterion,
  SMALL_BASE_THRESHOLD,
} from "@/lib/calculations/taste-model-health"
import type { WeightSuggestion } from "@/lib/ml/weight-inference"

// Helper: monta uma WeightSuggestion (delta derivado; coefficient/stderr irrelevantes p/ os flags).
function sug(
  slug: string,
  currentWeight: number,
  suggestedWeight: number,
  confidence: WeightSuggestion["confidence"] = "high",
): WeightSuggestion {
  return {
    slug: slug as WeightSuggestion["slug"],
    currentWeight,
    suggestedWeight,
    delta: suggestedWeight - currentWeight,
    confidence,
    coefficient: 0,
    stderr: 0,
  }
}

describe("flagsForCriterion", () => {
  it("sinal invertido: declarado + e inferido − (adult_content real: +6 → −14)", () => {
    const flags = flagsForCriterion(sug("adult_content", 6, -14, "high"))
    expect(flags).toEqual([{ kind: "sign_flip", severity: "high" }])
  })

  it("sinal invertido também no sentido oposto (drama real: −5 → +22)", () => {
    expect(flagsForCriterion(sug("drama", -5, 22, "medium"))).toEqual([
      { kind: "sign_flip", severity: "high" },
    ])
  })

  it("peso sem sustentação: declarado forte, inferido ~0 (tragedy real: −15 → +1.3)", () => {
    expect(flagsForCriterion(sug("tragedy", -15, 1.3, "low"))).toEqual([
      { kind: "unsupported", severity: "medium" },
    ])
  })

  it("aposta frágil: inferido grande sobre confiança baixa", () => {
    expect(flagsForCriterion(sug("humor", 4, 14, "low"))).toEqual([
      { kind: "fragile_bet", severity: "medium" },
    ])
  })

  it("mesma direção e estável → sem flag (romance: +15 → +30)", () => {
    expect(flagsForCriterion(sug("romance", 15, 30.1, "medium"))).toEqual([])
  })

  it("pesos triviais nos dois lados não geram sinal invertido", () => {
    expect(flagsForCriterion(sug("x", 2, -2, "high"))).toEqual([])
  })

  it("sinal invertido pode acumular aposta frágil (opostos + inferido grande + baixa conf)", () => {
    const flags = flagsForCriterion(sug("y", 6, -12, "low"))
    expect(flags).toContainEqual({ kind: "sign_flip", severity: "high" })
    expect(flags).toContainEqual({ kind: "fragile_bet", severity: "medium" })
  })
})

describe("computeTasteModelHealth", () => {
  const suggestions = [
    sug("romance", 15, 30.1, "medium"),
    sug("adult_content", 6, -14, "high"), // sign_flip
    sug("tragedy", -15, 1.3, "low"), // unsupported
    sug("drama", -5, 22, "medium"), // sign_flip
    sug("protagonist", 31.6, 42.5, "high"),
  ]

  it("conta os flags por tipo", () => {
    const h = computeTasteModelHealth(suggestions, 211)
    expect(h.counts).toEqual({ signFlip: 2, unsupported: 1, fragile: 0 })
    expect(h.flagged).toHaveLength(3)
  })

  it("ordena os de severidade alta primeiro", () => {
    const h = computeTasteModelHealth(suggestions, 211)
    // os 2 primeiros são os sign_flip (severidade high)
    expect(h.criteria.slice(0, 2).map((c) => c.slug).sort()).toEqual(["adult_content", "drama"])
    // o último não tem flag
    expect(h.criteria[h.criteria.length - 1].flags).toEqual([])
  })

  it("marca base pequena abaixo do limiar", () => {
    expect(computeTasteModelHealth(suggestions, SMALL_BASE_THRESHOLD - 1).smallBase).toBe(true)
    expect(computeTasteModelHealth(suggestions, SMALL_BASE_THRESHOLD + 1).smallBase).toBe(false)
  })
})
