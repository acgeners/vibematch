import { describe, expect, it } from "vitest"
import { tasteProfileToolPayloadSchema } from "@/lib/ai-recommendation/schema"

// Regressão: no Zod 4, `z.record(enum, …)` é EXAUSTIVO — exige os 9 slugs. Como o
// prompt manda o modelo OMITIR critério sem evidência, um perfil legítimo com 8
// critérios era rejeitado e o "Recomputar" falhava inteiro.

const pref = { ideal_min: 6, ideal_max: 9, weight: 0.8, note: null }

function payload(criterionPreferences: Record<string, unknown>) {
  return {
    loved_tags: [{ name: "slow burn", group: "romance", strength: 0.9 }],
    avoided_tags: [],
    loved_themes: ["redenção"],
    avoided_themes: [],
    criterion_preferences: criterionPreferences,
    narrative_patterns: [],
    summary: "gosta de romance lento",
  }
}

describe("tasteProfileToolPayloadSchema — criterion_preferences", () => {
  it("aceita perfil PARCIAL (só alguns critérios)", () => {
    const parsed = tasteProfileToolPayloadSchema.safeParse(
      payload({ romance: pref, humor: pref }),
    )

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data!.criterion_preferences)).toEqual(["romance", "humor"])
  })

  it("aceita criterion_preferences vazio sem descartar o resto do perfil", () => {
    const parsed = tasteProfileToolPayloadSchema.safeParse(payload({}))

    expect(parsed.success).toBe(true)
    expect(parsed.data!.criterion_preferences).toEqual({})
    expect(parsed.data!.loved_tags).toHaveLength(1)
  })

  it("dropa slug fora do catálogo sem custar os slugs válidos", () => {
    const parsed = tasteProfileToolPayloadSchema.safeParse(
      payload({ romance: pref, slug_inexistente: pref }),
    )

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data!.criterion_preferences)).toEqual(["romance"])
  })

  it("continua rejeitando preferência mal-formada num slug válido", () => {
    const parsed = tasteProfileToolPayloadSchema.safeParse(
      payload({ romance: { ideal_min: 6, ideal_max: 9, weight: 42 } }),
    )

    expect(parsed.success).toBe(false)
  })
})
