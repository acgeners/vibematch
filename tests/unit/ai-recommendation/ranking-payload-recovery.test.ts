import { describe, it, expect } from "vitest"
import { coerceToolPayload } from "@/lib/ai/tool-payload"
import { rankingToolPayloadSchema } from "@/lib/ai-recommendation/schema"

// Visto em produção: a run de ranking inteira era descartada com
//   "mode_summary: expected string, received undefined; rankings: expected array, received string"
// Não era truncamento — o modelo serializou o array `rankings` como STRING de
// JSON e omitiu o `mode_summary`. Duas tentativas e ~20 obras já rankeadas
// jogadas fora por uma questão de codificação + um parágrafo de resumo ausente.
//
// A recuperação tem duas pontas, cada uma com sua rede de segurança:
//   1) coerceToolPayload(["rankings"]) desembrulha o array — SEM inventar dado.
//   2) o schema tolera mode_summary ausente com um fallback — o ranking é o valor.

const rankings = [
  { work_id: "w1", alignment_score: 92, justification: "Match forte.", top_match_factors: ["ação"] },
  { work_id: "w2", alignment_score: 71, justification: "Match médio.", top_match_factors: ["drama"] },
]

describe("coerceToolPayload — parametrizável por campo (fluxo de ranking)", () => {
  it("rankings como string de JSON: vira array e reporta o campo", () => {
    const { value, coerced } = coerceToolPayload(
      { mode_summary: "Padrão claro de ação.", rankings: JSON.stringify(rankings) },
      ["rankings"],
    )
    expect((value as { rankings: unknown }).rankings).toEqual(rankings)
    expect(coerced).toEqual(["rankings"])
  })

  it("NÃO mexe em `scores` quando os campos são só `rankings`", () => {
    // Prova que a parametrização isola os fluxos: um campo do outro subsistema
    // não é desembrulhado por engano.
    const { value, coerced } = coerceToolPayload(
      { rankings: JSON.stringify(rankings), scores: JSON.stringify([{ a: 1 }]) },
      ["rankings"],
    )
    expect((value as { scores: unknown }).scores).toBe(JSON.stringify([{ a: 1 }]))
    expect(coerced).toEqual(["rankings"])
  })

  it("prosa em rankings: NÃO adivinha — segue string e o schema reprova", () => {
    const { value, coerced } = coerceToolPayload(
      { mode_summary: "x", rankings: "não consegui rankear" },
      ["rankings"],
    )
    expect((value as { rankings: unknown }).rankings).toBe("não consegui rankear")
    expect(coerced).toEqual([])
  })
})

describe("rankingToolPayloadSchema — tolera mode_summary ausente", () => {
  it("mode_summary undefined vira fallback, não descarta o ranking", () => {
    const parsed = rankingToolPayloadSchema.safeParse({ rankings })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.mode_summary).toBe("(ranking gerado sem resumo)")
      expect(parsed.data.rankings).toEqual(rankings)
    }
  })

  it("mode_summary presente é preservado (trim aplicado)", () => {
    const parsed = rankingToolPayloadSchema.safeParse({ mode_summary: "  Ação pesada.  ", rankings })
    expect(parsed.success && parsed.data.mode_summary).toBe("Ação pesada.")
  })
})

describe("recuperação ponta-a-ponta do erro de produção", () => {
  it("rankings string + mode_summary ausente: coerce → schema aprova", () => {
    // O payload EXATO que reprovava com os dois issues juntos.
    const raw = { rankings: JSON.stringify(rankings) }
    const { value, coerced } = coerceToolPayload(raw, ["rankings"])
    expect(coerced).toEqual(["rankings"])
    const parsed = rankingToolPayloadSchema.safeParse(value)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.rankings).toEqual(rankings)
      expect(parsed.data.mode_summary).toBe("(ranking gerado sem resumo)")
    }
  })
})
