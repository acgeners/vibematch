import { describe, it, expect, vi, beforeEach } from "vitest"

// Lacuna #4: a inferência de tags na criação passou a AGUARDAR a consolidação da sinopse
// canônica (senão infere do fallback "sinopse mais longa", texto errado). Como a
// consolidação também roda numa `after()` PRÓPRIA e paralela, duas chamadas de
// `consolidateSynopsisForWork` para a MESMA obra podem coincidir. O que este arquivo
// prende: chamadas concorrentes disparam UM Haiku só (single-flight). Sabotagem: remover
// o single-flight ⇒ 2 chamadas ⇒ este teste quebra — é exatamente o buraco de custo (2×
// Haiku) que o hash-gate NÃO cobre (ambas leem o hash antes de qualquer uma gravar).

const consolidateSynopsis = vi.fn()

// Proxy que finge o query-builder do supabase: todo método encadeia; `then` resolve o
// resultado. Mesmo truque dos outros testes (ex.: comix-quick-resolve).
const chain = (result: unknown): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        return () => chain(result)
      },
    },
  ) as Record<string, unknown>

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === "work_synopses"
          ? { data: [{ text: "Uma sinopse bruta longa o suficiente pra passar do mínimo." }], error: null }
          : { data: { canonical_synopsis_inputs_hash: "OLD" }, error: null },
      ),
  }),
}))

vi.mock("@/lib/ai-recommendation/synopsis-consolidator", () => ({
  consolidateSynopsis: (...args: unknown[]) => consolidateSynopsis(...(args as [])),
  hashSynopsisInputs: () => "NEW", // ≠ "OLD" ⇒ não é "fresh": força o caminho do Haiku
}))

vi.mock("@/lib/work-derived", () => ({
  splitSynopsesFromText: (t: string) => [t],
}))

vi.mock("@/server/queries/synopsis-quality", () => ({
  markWorkSynopsisPredictionStale: async () => {},
}))

import { consolidateSynopsisForWork } from "@/lib/ai-recommendation/consolidate-for-work"

beforeEach(() => {
  vi.clearAllMocks()
  consolidateSynopsis.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20)) // latência do Haiku ⇒ garante sobreposição
    return { canonical: "Sinopse canônica." }
  })
})

describe("consolidateSynopsisForWork — single-flight (Lacuna #4)", () => {
  it("duas chamadas CONCORRENTES pra mesma obra ⇒ UM Haiku só", async () => {
    const [a, b] = await Promise.all([
      consolidateSynopsisForWork("w1"),
      consolidateSynopsisForWork("w1"),
    ])
    expect(consolidateSynopsis).toHaveBeenCalledTimes(1) // ⬅ sem single-flight: 2
    expect(a).toEqual({ status: "done" })
    expect(b).toEqual({ status: "done" }) // a 2ª reusa a MESMA promise
  })

  it("obras DIFERENTES não compartilham a promise (não coalesce à toa)", async () => {
    await Promise.all([
      consolidateSynopsisForWork("w1"),
      consolidateSynopsisForWork("w2"),
    ])
    expect(consolidateSynopsis).toHaveBeenCalledTimes(2)
  })

  it("após concluir, a entrada sai do mapa — só coalesce o que está EM VOO", async () => {
    await consolidateSynopsisForWork("w1")
    await consolidateSynopsisForWork("w1") // sequencial: já não está em voo ⇒ re-roda
    expect(consolidateSynopsis).toHaveBeenCalledTimes(2)
  })
})
