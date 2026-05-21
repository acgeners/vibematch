import { describe, it, expect } from "vitest"
import { computePersonalFit } from "@/lib/ai-recommendation/personal-fit"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"

const emptyProfile: TasteProfilePayload = {
  loved_tags: [],
  avoided_tags: [],
  loved_themes: [],
  avoided_themes: [],
  criterion_preferences: {},
  narrative_patterns: [],
  summary: "",
}

describe("computePersonalFit", () => {
  it("retorna null quando perfil não traz nenhum sinal", () => {
    const result = computePersonalFit(emptyProfile, {
      tags: [{ name: "Romance", group: "romance" }],
      categoryScores: { romance: 8 },
    })
    expect(result).toBeNull()
  })

  it("retorna valor alto quando obra casa com loved_tags e criterion_preferences", () => {
    const profile: TasteProfilePayload = {
      ...emptyProfile,
      loved_tags: [
        { name: "Slow Burn", group: "romance", strength: 0.9 },
        { name: "Politics", group: "themes", strength: 0.7 },
      ],
      criterion_preferences: {
        romance: { ideal_min: 7, ideal_max: 9, weight: 1 },
        fantasy_nobility: { ideal_min: 6, ideal_max: 9, weight: 0.8 },
      },
    }
    const result = computePersonalFit(profile, {
      tags: [
        { name: "Slow Burn", group: "romance" },
        { name: "Politics", group: "themes" },
      ],
      categoryScores: { romance: 8, fantasy_nobility: 7 },
    })
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0.7)
  })

  it("avoided_tags derrubam o score", () => {
    const profile: TasteProfilePayload = {
      ...emptyProfile,
      loved_tags: [{ name: "Adventure", group: "themes", strength: 1 }],
      avoided_tags: [{ name: "Tragedy", group: "tone_mood", strength: 1 }],
    }
    const withoutAvoided = computePersonalFit(profile, {
      tags: [{ name: "Adventure", group: "themes" }],
      categoryScores: {},
    })
    const withAvoided = computePersonalFit(profile, {
      tags: [
        { name: "Adventure", group: "themes" },
        { name: "Tragedy", group: "tone_mood" },
      ],
      categoryScores: {},
    })
    expect(withAvoided).not.toBeNull()
    expect(withoutAvoided).not.toBeNull()
    expect(withAvoided!).toBeLessThan(withoutAvoided!)
  })

  it("criterion_alignment cai com distância da faixa ideal", () => {
    const profile: TasteProfilePayload = {
      ...emptyProfile,
      criterion_preferences: {
        romance: { ideal_min: 7, ideal_max: 9, weight: 1 },
      },
    }
    const inRange = computePersonalFit(profile, {
      tags: [],
      categoryScores: { romance: 8 },
    })
    const slightlyOut = computePersonalFit(profile, {
      tags: [],
      categoryScores: { romance: 5 },
    })
    const wayOff = computePersonalFit(profile, {
      tags: [],
      categoryScores: { romance: 1 },
    })
    expect(inRange!).toBeGreaterThan(slightlyOut!)
    expect(slightlyOut!).toBeGreaterThan(wayOff!)
  })

  it("retorna valor entre 0 e 1 sempre", () => {
    const profile: TasteProfilePayload = {
      ...emptyProfile,
      loved_tags: [{ name: "X", group: null, strength: 1 }],
      avoided_tags: [{ name: "Y", group: null, strength: 1 }],
      criterion_preferences: {
        drama: { ideal_min: 0, ideal_max: 3, weight: 1 },
      },
    }
    for (let drama = 0; drama <= 10; drama += 1) {
      const result = computePersonalFit(profile, {
        tags: [{ name: "Y", group: null }],
        categoryScores: { drama },
      })
      expect(result).not.toBeNull()
      expect(result!).toBeGreaterThanOrEqual(0)
      expect(result!).toBeLessThanOrEqual(1)
    }
  })

  it("ignora critérios sem score na obra", () => {
    const profile: TasteProfilePayload = {
      ...emptyProfile,
      criterion_preferences: {
        romance: { ideal_min: 7, ideal_max: 9, weight: 1 },
        drama: { ideal_min: 0, ideal_max: 3, weight: 1 },
      },
    }
    const onlyRomance = computePersonalFit(profile, {
      tags: [],
      categoryScores: { romance: 8 },
    })
    expect(onlyRomance).not.toBeNull()
    expect(onlyRomance!).toBeGreaterThan(0.8)
  })
})
