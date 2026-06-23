import { describe, it, expect } from "vitest"
import { relevantSynopsisSignature, analyzeStalenessTransitions } from "@/lib/synopsis-interest/staleness"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"

const base: TasteProfilePayload = {
  loved_tags: [{ name: "romance", group: null, strength: 0.9 }],
  avoided_tags: [{ name: "tragedy", group: null, strength: 0.8 }],
  loved_themes: ["slow burn"],
  avoided_themes: ["rape"],
  criterion_preferences: { romance: { ideal_min: 7, ideal_max: 9, weight: 1 } },
  narrative_patterns: ["redemption arc"],
  summary: "qualquer texto",
}

describe("relevantSynopsisSignature", () => {
  it("muda quando um loved_tag relevante muda de força", () => {
    const a = relevantSynopsisSignature(base)
    const b = relevantSynopsisSignature({ ...base, loved_tags: [{ name: "romance", group: null, strength: 0.5 }] })
    expect(a).not.toBe(b)
  })

  it("NÃO muda quando só criterion_preferences/narrative_patterns/summary mudam", () => {
    const a = relevantSynopsisSignature(base)
    const b = relevantSynopsisSignature({
      ...base,
      criterion_preferences: { romance: { ideal_min: 1, ideal_max: 10, weight: 0.2 }, tragedy: { ideal_min: 5, ideal_max: 9, weight: 1 } },
      narrative_patterns: ["totalmente diferente"],
      summary: "outro texto",
    })
    expect(a).toBe(b) // estável → evitaria a invalidação
  })

  it("ignora jitter < 0.01 (arredondamento)", () => {
    const a = relevantSynopsisSignature(base)
    const b = relevantSynopsisSignature({ ...base, loved_tags: [{ name: "romance", group: null, strength: 0.903 }] })
    expect(a).toBe(b)
  })
})

describe("analyzeStalenessTransitions", () => {
  it("conta invalidações evitadas (cheia mudou, estreita não)", () => {
    const v = [
      { fullSig: "A", relevantSig: "X" },
      { fullSig: "B", relevantSig: "X" }, // cheia muda, estreita não → evitada
      { fullSig: "C", relevantSig: "Y" }, // ambas mudam
      { fullSig: "C", relevantSig: "Y" }, // nada muda
    ]
    const r = analyzeStalenessTransitions(v)
    expect(r.transitions).toBe(3)
    expect(r.fullChanges).toBe(2)
    expect(r.relevantChanges).toBe(1)
    expect(r.avoidedInvalidations).toBe(1)
    expect(r.avoidedRate).toBeCloseTo(0.5)
  })

  it("lista vazia / única versão → zero", () => {
    expect(analyzeStalenessTransitions([]).transitions).toBe(0)
    expect(analyzeStalenessTransitions([{ fullSig: "A", relevantSig: "X" }]).fullChanges).toBe(0)
  })
})
