import { describe, expect, it } from "vitest"
import { EXTERNAL_SOURCE_ORDER, SELECTABLE_EXTERNAL_SOURCES, sourceOrderIndex } from "@/lib/external/source-order"
import { selectReviewsForEvaluation } from "@/lib/external/index"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"

describe("EXTERNAL_SOURCE_ORDER (ordem canônica, gerada do DB)", () => {
  it("cobre todas as fontes, sem repetição", () => {
    expect(new Set(EXTERNAL_SOURCE_ORDER).size).toBe(EXTERNAL_SOURCE_ORDER.length)
  })

  it("`outros` (catch-all) não é selecionável no diálogo", () => {
    expect(SELECTABLE_EXTERNAL_SOURCES).not.toContain("outros")
    expect(EXTERNAL_SOURCE_ORDER).toContain("outros")
  })

  it("fonte desconhecida ordena no FIM, não no começo", () => {
    // O bug original: `indexOf` devolvia −1 pra fonte fora da lista, e −1 ordena
    // ANTES de tudo — o Mangago aparecia no topo do diálogo.
    for (const source of EXTERNAL_SOURCE_ORDER) {
      expect(sourceOrderIndex("nao-existe")).toBeGreaterThan(sourceOrderIndex(source))
    }
  })
})

// A prioridade das reviews no prompt da IA é ACOPLADA à ordem de exibição
// (`EXTERNAL_SOURCE_ORDER`, gerada do DB) — UMA fonte de verdade, por decisão. Este
// teste prova o acoplamento: o round-robin sai na MESMA ordem que a exibição, seja ela
// qual for (não hardcodamos uma ordem específica, que o próximo sync mudaria).
describe("prioridade das reviews da IA segue a ordem canônica (acoplado à coluna order do DB)", () => {
  const review = (source: ExternalSourceId, i: number): SourcedReview => ({
    source,
    sourceTitle: "Reeling in the Male Lead",
    matchScore: 1,
    text: `review ${source} ${i}`.padEnd(200, "x"),
    textLength: 200,
  })

  it("com orçamento de 1 por fonte, o round-robin segue EXATAMENTE EXTERNAL_SOURCE_ORDER", () => {
    const sources = [...SELECTABLE_EXTERNAL_SOURCES]
    // Entrada na ordem INVERSA de propósito: o que manda é a prioridade (= a ordem
    // canônica), não a ordem em que as reviews chegaram.
    const pool = [...sources].reverse().flatMap((s) => [review(s, 1), review(s, 2)])

    const picked = selectReviewsForEvaluation(pool, { total: sources.length, maxPerSource: 1 })

    const esperado = [...sources].sort((a, b) => sourceOrderIndex(a) - sourceOrderIndex(b))
    expect(picked.map((r) => r.source)).toEqual(esperado)
  })

  it("a 1ª fonte da ordem canônica é a 1ª a ser consumida nas reviews", () => {
    const [primeira, segunda, terceira] = SELECTABLE_EXTERNAL_SOURCES
    const picked = selectReviewsForEvaluation(
      [review(terceira, 1), review(primeira, 1), review(segunda, 1)],
      { total: 3, maxPerSource: 1 }
    )
    expect(picked[0].source).toBe(primeira)
  })
})
