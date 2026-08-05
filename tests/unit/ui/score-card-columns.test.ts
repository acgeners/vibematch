import { describe, expect, it } from "vitest"

import { balanceScoreCardColumns } from "@/lib/ui/score-card-columns"

describe("balanceScoreCardColumns", () => {
  it("abre as fontes externas em 2 colunas quando elas são muito mais numerosas", () => {
    // Caso real que motivou o helper: 9 fontes ao lado de Alinhamento + Veredito.
    expect(balanceScoreCardColumns({ calcCount: 2, externalCount: 9 })).toEqual({
      calc: 1,
      external: 2,
    })
  })

  it("mantém tudo em coluna única quando as contagens são parecidas", () => {
    // 5 fontes × 3 notas: a quebra deixaria buraco na última linha sem equilibrar de fato.
    expect(balanceScoreCardColumns({ calcCount: 3, externalCount: 5 })).toEqual({
      calc: 1,
      external: 1,
    })
  })

  it("trata diferença de até 2 itens como parecida, nos dois sentidos", () => {
    for (const [calcCount, externalCount] of [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 2],
      [2, 2],
    ] as const) {
      expect(balanceScoreCardColumns({ calcCount, externalCount })).toEqual({
        calc: 1,
        external: 1,
      })
    }
  })

  it("abre as notas calculadas quando é ELA a lista longa", () => {
    expect(balanceScoreCardColumns({ calcCount: 4, externalCount: 1 })).toEqual({
      calc: 2,
      external: 1,
    })
  })

  it("nunca quebra os dois cards ao mesmo tempo", () => {
    for (let calcCount = 0; calcCount <= 6; calcCount++) {
      for (let externalCount = 1; externalCount <= 12; externalCount++) {
        const cols = balanceScoreCardColumns({ calcCount, externalCount })
        expect(cols.calc === 2 && cols.external === 2).toBe(false)
      }
    }
  })

  it("sem fontes externas, o card de notas segue a regra de card sozinho (≥3 → 2 colunas)", () => {
    expect(balanceScoreCardColumns({ calcCount: 3, externalCount: 0 })).toEqual({
      calc: 2,
      external: 1,
    })
    expect(balanceScoreCardColumns({ calcCount: 2, externalCount: 0 })).toEqual({
      calc: 1,
      external: 1,
    })
    expect(balanceScoreCardColumns({ calcCount: 0, externalCount: 0 })).toEqual({
      calc: 1,
      external: 1,
    })
  })
})
