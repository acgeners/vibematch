import { describe, it, expect } from "vitest"
import { computeInterestAccuracy, MIN_ACCURACY_SAMPLE } from "@/lib/ai-evaluation/interest-accuracy"
import type { InterestAccuracyRow } from "@/lib/ai-evaluation/interest-accuracy"

/**
 * A "Confiança" da previsão de Interesse (/my-ai-scores, aba Interesse) mentia de dois jeitos,
 * medidos na nuvem em 2026-11-16 (prompt v4):
 *
 * 🔴 Só contava previsões FRESCAS, e 777 de 779 estavam desatualizadas: a pílula dizia
 * "alta" sobre n = 2. Com a previsão mais recente de cada obra, mesmo desatualizada, n = 578.
 *
 * 🔴 Contava o Interesse vindo do "Aplicar" — a previsão concordando consigo mesma: essas
 * acertavam 79% exato contra 55% das dadas à mão.
 */

function row(over: Partial<InterestAccuracyRow>): InterestAccuracyRow {
  return { workId: "w1", predictedAt: "2026-10-01T00:00:00Z", predicted: "♥♥", manual: "♥♥", manualSource: "human_manual", ...over }
}

describe("computeInterestAccuracy", () => {
  it("usa a previsão MAIS RECENTE de cada obra", () => {
    const acc = computeInterestAccuracy([
      row({ predictedAt: "2026-09-01T00:00:00Z", predicted: "♥" }),
      row({ predictedAt: "2026-10-01T00:00:00Z", predicted: "♥♥♥" }),
    ])
    expect(acc.n).toBe(1)
    expect(acc.mae).toBe(1)
    expect(acc.meanDelta).toBe(1)
  })

  it("o Interesse do 'Aplicar' fica FORA e é contado à parte", () => {
    const acc = computeInterestAccuracy([
      row({ workId: "a", predicted: "♥♥♥♥", manual: "♥♥" }),
      row({ workId: "b", predicted: "♥♥", manual: "♥♥", manualSource: "prediction_applied" }),
      row({ workId: "c", predicted: "♥♥", manual: "♥♥", manualSource: "prediction_applied" }),
    ])
    // Contraprova do arranjo antigo: com as aplicadas, o erro médio cairia para 2/3.
    expect(acc.n).toBe(1)
    expect(acc.mae).toBe(2)
    expect(acc.exactRate).toBe(0)
    expect(acc.appliedExcluded).toBe(2)
  })

  it("procedência desconhecida (anterior à migration 108) também fica fora, sem contar como aplicada", () => {
    const acc = computeInterestAccuracy([row({ manualSource: "legacy_unknown" })])
    expect(acc).toMatchObject({ n: 0, mae: null, appliedExcluded: 0 })
  })

  it("obra sem previsão ou sem Interesse não entra", () => {
    const acc = computeInterestAccuracy([row({ workId: "a", predicted: null }), row({ workId: "b", manual: null })])
    expect(acc.n).toBe(0)
  })

  it("o piso de amostra existe e é o que a tela já chamava de 'amostra pequena'", () => {
    expect(MIN_ACCURACY_SAMPLE).toBe(10)
  })
})
