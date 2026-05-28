import { describe, it, expect } from "vitest"
import { deepDiveToolPayloadSchema } from "@/lib/ai-recommendation/deep-dive-schema"

const VALID_PAYLOAD = {
  match_score: 78,
  confidence: 0.82,
  one_liner: "Slow-burn político com FL de agência forte — encaixa, mas drama denso.",
  alignment_breakdown: {
    tags_pros: [
      { tag: "strong-female-lead", impact: 0.9, why: "FL com agência forte — padrão claro do user." },
    ],
    tags_cons: [
      { tag: "tragedy", impact: 0.7, why: "Tag avoided no perfil; obra tem morte central." },
    ],
    criteria_pros: [
      {
        criterion: "couple_dynamics",
        score: 8,
        ideal_range: [7, 10],
        why: "Dentro da faixa ideal do user; romance slow-burn bem construído.",
      },
    ],
    criteria_cons: [
      {
        criterion: "drama",
        score: 8.5,
        ideal_range: [3, 6],
        why: "Acima do tolerado pelo perfil; drama denso por 200+ capítulos.",
      },
    ],
    narrative_match: [
      {
        pattern: "FL com agência forte + slow-burn romance + corte política",
        evidence: "Sinopse mostra FL navegando intrigas; reviews destacam pacing romântico [R3].",
      },
    ],
  },
  similar_in_library: [
    {
      work_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      similarity_reason: "Mesma vibe de corte real + FL estrategista que você amou.",
      user_score: 9,
      alignment_signal: "positive",
    },
  ],
  review_synthesis: {
    consensus: "Reviews concordam que arte e world-building são fortes.",
    divergence: "Alguns acham pacing irregular; outros gostam da construção lenta.",
    flags: ["pacing irregular no arco intermediário"],
  },
  mood_match: { fit: 0.4, why: "User pediu algo leve; obra é drama denso." },
  read_recommendation: {
    when: "guardar",
    reasoning: "Match forte de elementos narrativos, mas conflita com mood atual.",
    suggested_alternative_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  },
}

describe("deepDiveToolPayloadSchema", () => {
  it("aceita payload válido completo (com mood + alternativa)", () => {
    const result = deepDiveToolPayloadSchema.safeParse(VALID_PAYLOAD)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.match_score).toBe(78)
      expect(result.data.confidence).toBeCloseTo(0.82)
      expect(result.data.similar_in_library).toHaveLength(1)
      expect(result.data.read_recommendation.suggested_alternative_id).toBe(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      )
    }
  })

  it("aceita mood_match nulo quando user não enviou contexto", () => {
    const payload = { ...VALID_PAYLOAD, mood_match: null }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it("aceita read_recommendation sem suggested_alternative_id", () => {
    const payload = {
      ...VALID_PAYLOAD,
      read_recommendation: {
        when: "agora",
        reasoning: "Match excepcional e mood favorável.",
      },
    }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it("rejeita match_score fora do range 0-100", () => {
    const payload = { ...VALID_PAYLOAD, match_score: 150 }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("rejeita confidence fora do range 0-1", () => {
    const payload = { ...VALID_PAYLOAD, confidence: 1.5 }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("rejeita read_recommendation.when fora do enum", () => {
    const payload = {
      ...VALID_PAYLOAD,
      read_recommendation: { ...VALID_PAYLOAD.read_recommendation, when: "maybe" },
    }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("rejeita alignment_signal fora do enum em similar_in_library", () => {
    const payload = {
      ...VALID_PAYLOAD,
      similar_in_library: [
        { ...VALID_PAYLOAD.similar_in_library[0], alignment_signal: "weird" },
      ],
    }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("rejeita ideal_range com tamanho diferente de 2", () => {
    const payload = {
      ...VALID_PAYLOAD,
      alignment_breakdown: {
        ...VALID_PAYLOAD.alignment_breakdown,
        criteria_pros: [
          {
            ...VALID_PAYLOAD.alignment_breakdown.criteria_pros[0],
            ideal_range: [5, 7, 9],
          },
        ],
      },
    }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("rejeita campos obrigatórios ausentes (alignment_breakdown)", () => {
    const payload = { ...VALID_PAYLOAD } as Record<string, unknown>
    delete payload.alignment_breakdown
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it("aceita arrays vazios em alignment_breakdown (zero pros/cons válido)", () => {
    const payload = {
      ...VALID_PAYLOAD,
      alignment_breakdown: {
        tags_pros: [],
        tags_cons: [],
        criteria_pros: [],
        criteria_cons: [],
        narrative_match: [],
      },
    }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it("aceita similar_in_library vazio (nenhuma similar encontrada)", () => {
    const payload = { ...VALID_PAYLOAD, similar_in_library: [] }
    const result = deepDiveToolPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})
