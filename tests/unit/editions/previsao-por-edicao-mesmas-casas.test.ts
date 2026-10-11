import { describe, it, expect } from "vitest"
import { asPersistedEditionPrediction, EDITION_PREDICTION_SCALE, roundLikeNumericColumn } from "@/lib/editions/mixed-edition"

/**
 * A cópia por edição da Nota Prevista (`expected_by_edition`, jsonb) tem de sair com as MESMAS casas
 * que o banco grava nas colunas de sempre (`numeric(4,2)` etc.) — senão a página (que lê o jsonb) e a
 * home/hover (que leem a coluna) arredondam a mesma previsão de pontos diferentes. Caso real
 * (2026-10-11): *I Tamed the Angsty Male Lead With My Fists*, coluna 7,75 ⇒ "7,8", jsonb 7,7478 ⇒ "7,7".
 *
 * Os esperados abaixo saíram do POSTGRES (`round(texto::numeric, casas)`), não de dedução: a função foi
 * conferida contra ele em 20.020 casos por escala, 0 divergências.
 */
const DO_POSTGRES: Record<2 | 3, Array<[number, number]>> = {
  2: [[7.745, 7.75], [7.747763551443355, 7.75], [5.845796721612336, 5.85], [7.545608143468077, 7.55], [-0.0005, 0], [0.0005, 0],
      [2.675, 2.68], [1.005, 1.01], [8.05, 8.05], [9.999, 10], [10, 10], [0, 0], [1e-8, 0], [-1e-8, 0], [0.1 + 0.2, 0.3], [6.995, 7], [-2.345, -2.35]],
  3: [[7.747763551443355, 7.748], [-0.0005, -0.001], [-0.0004, 0], [0.0005, 0.001], [2.675, 2.675], [3.14159, 3.142], [4.4449999, 4.445], [1e-8, 0]],
}

describe("roundLikeNumericColumn arredonda como a coluna numeric do banco", () => {
  it.each([2, 3] as const)("casas=%s — os resultados do Postgres", (casas) => {
    for (const [x, pg] of DO_POSTGRES[casas]) expect(roundLikeNumericColumn(x, casas), String(x)).toBe(pg)
  })
  it("o atalho Math.round NÃO serve (erra justo nas bordas que o banco arredonda pra cima)", () => {
    const atalho = (x: number) => Math.round(x * 100) / 100
    expect([atalho(7.745), atalho(2.675), atalho(1.005)]).not.toEqual([7.75, 2.68, 1.01])
    expect([7.745, 2.675, 1.005].map((x) => roundLikeNumericColumn(x, 2))).toEqual([7.75, 2.68, 1.01])
  })
})

describe("a previsão por edição sai com as casas das colunas", () => {
  it("cada campo na escala da sua coluna; nulos e stubs intactos", () => {
    const p = asPersistedEditionPrediction({
      expected_score: 7.747763551443355, expected_baseline: 7.5123456, expected_quality_adj: 0.2354321,
      expected_is_stub: false, chance_score: 61.23456, chance_is_stub: false,
    })
    expect(p).toEqual({ expected_score: 7.75, expected_baseline: 7.512, expected_quality_adj: 0.235, expected_is_stub: false, chance_score: 61.23, chance_is_stub: false })
    expect(asPersistedEditionPrediction({ expected_score: null, expected_baseline: null, expected_quality_adj: null, expected_is_stub: true, chance_score: null, chance_is_stub: true }))
      .toEqual({ expected_score: null, expected_baseline: null, expected_quality_adj: null, expected_is_stub: true, chance_score: null, chance_is_stub: true })
  })
  it("as escalas são as das colunas (migs 066/068/132/146)", () => {
    expect(EDITION_PREDICTION_SCALE).toEqual({ expected_score: 2, expected_baseline: 3, expected_quality_adj: 3, chance_score: 2 })
  })
})
