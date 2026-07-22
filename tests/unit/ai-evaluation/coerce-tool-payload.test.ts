import { describe, it, expect } from "vitest"
import { coerceToolPayload } from "@/lib/ai-evaluation/service"

// Visto em produção (2026-07-22, sonnet-5/v21): a avaliação inteira era descartada com
// "scores: Invalid input: expected array, received string". Não era truncamento —
// `stop_reason: "tool_use"`, ~1.5k tokens — o modelo só serializou o array como string.
// Duas tentativas, ~US$0,06 e ~40s jogados fora com o dado todo ali.
//
// A linha que este arquivo defende é fina: recuperar JSON de verdade SEM inventar dado.
// Uma coerção esperta demais (aceitar prosa, embrulhar valor solto num array) esconderia
// uma regressão real de modelo/prompt atrás de uma avaliação plausível — que é bem pior
// que o erro, porque entra no catálogo como fato da obra.

const scores = [
  { criterion: "romance", score: 8, justification: "Faixa 7-8 (Core Romance): foco claro." },
  { criterion: "drama", score: 4, justification: "Faixa 4-6: presente, não domina." },
]
const base = { summary: "Resumo.", confidence: 0.8 }

describe("coerceToolPayload — recupera duplo-encode sem inventar dado", () => {
  it("scores como string de JSON: vira array e reporta o campo", () => {
    const { value, coerced } = coerceToolPayload({ ...base, scores: JSON.stringify(scores) })
    expect((value as { scores: unknown }).scores).toEqual(scores)
    expect(coerced).toEqual(["scores"])
  })

  it("input INTEIRO como string de JSON: também recupera", () => {
    const { value, coerced } = coerceToolPayload(JSON.stringify({ ...base, scores }))
    expect(value).toEqual({ ...base, scores })
    expect(coerced).toEqual(["input"])
  })

  it("payload já correto: devolve igual e NÃO marca coerção", () => {
    const input = { ...base, scores }
    const { value, coerced } = coerceToolPayload(input)
    expect(value).toEqual(input)
    expect(coerced).toEqual([])
  })

  it("prosa em scores: NÃO tenta adivinhar — segue string e o schema reprova", () => {
    const { value, coerced } = coerceToolPayload({ ...base, scores: "não consegui avaliar" })
    expect((value as { scores: unknown }).scores).toBe("não consegui avaliar")
    expect(coerced).toEqual([])
  })

  it("string de JSON que vira escalar não é aceita como estrutura", () => {
    // JSON.parse('"8"') → "8" e JSON.parse('8') → 8: nada disso é o array perdido.
    for (const raw of ['"8"', "8", "null"]) {
      const { value, coerced } = coerceToolPayload({ ...base, scores: raw })
      expect((value as { scores: unknown }).scores).toBe(raw)
      expect(coerced).toEqual([])
    }
  })

  it("JSON quebrado (truncado): devolve como veio, sem lançar", () => {
    const truncated = JSON.stringify(scores).slice(0, 40)
    const { value, coerced } = coerceToolPayload({ ...base, scores: truncated })
    expect((value as { scores: unknown }).scores).toBe(truncated)
    expect(coerced).toEqual([])
  })

  it("não mutila o objeto original nem perde campos vizinhos", () => {
    const input = { ...base, scores: JSON.stringify(scores), reviewsRejectedReason: "x" }
    const { value } = coerceToolPayload(input)
    expect(value).toMatchObject({ summary: "Resumo.", confidence: 0.8, reviewsRejectedReason: "x" })
    expect(input.scores).toBe(JSON.stringify(scores)) // entrada intacta
  })

  it("entradas degeneradas não explodem", () => {
    expect(coerceToolPayload(null).value).toBeNull()
    expect(coerceToolPayload(undefined).value).toBeUndefined()
    expect(coerceToolPayload("texto solto").value).toBe("texto solto")
  })
})
