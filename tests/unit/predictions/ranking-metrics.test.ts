import { describe, it, expect } from "vitest"
import {
  spearman,
  kendallTau,
  pairwiseAccuracy,
  ndcgAtK,
  precisionAtK,
  regretAtK,
  computeRankingMetrics,
  type RankedPair,
} from "@/lib/metrics/ranking-metrics"

const perfect: RankedPair[] = [
  { predicted: 1, actual: 1 },
  { predicted: 2, actual: 2 },
  { predicted: 3, actual: 3 },
  { predicted: 4, actual: 4 },
]
const reversed: RankedPair[] = [
  { predicted: 4, actual: 1 },
  { predicted: 3, actual: 2 },
  { predicted: 2, actual: 3 },
  { predicted: 1, actual: 4 },
]

describe("spearman / kendall / pairwise", () => {
  it("ordem perfeita → +1", () => {
    expect(spearman(perfect)).toBeCloseTo(1, 6)
    expect(kendallTau(perfect)).toBeCloseTo(1, 6)
    expect(pairwiseAccuracy(perfect)).toBe(1)
  })
  it("ordem invertida → -1 / 0", () => {
    expect(spearman(reversed)).toBeCloseTo(-1, 6)
    expect(kendallTau(reversed)).toBeCloseTo(-1, 6)
    expect(pairwiseAccuracy(reversed)).toBe(0)
  })
  it("amostra insuficiente (1 par) → null", () => {
    expect(spearman([{ predicted: 1, actual: 1 }])).toBeNull()
    expect(kendallTau([{ predicted: 1, actual: 1 }])).toBeNull()
    expect(pairwiseAccuracy([{ predicted: 1, actual: 1 }])).toBeNull()
  })
  it("empate na previsão conta 0,5 no pairwise", () => {
    const pairs: RankedPair[] = [
      { predicted: 5, actual: 1 },
      { predicted: 5, actual: 2 },
    ]
    expect(pairwiseAccuracy(pairs)).toBe(0.5)
  })
})

describe("ndcg / precision / regret", () => {
  it("NDCG@k = 1 quando a previsão ordena perfeitamente", () => {
    expect(ndcgAtK(perfect, 4)).toBeCloseTo(1, 6)
  })
  it("Precision@k conta relevantes (actual >= threshold) no top-k", () => {
    const pairs: RankedPair[] = [
      { predicted: 9, actual: 9 }, // relevante
      { predicted: 8, actual: 6 }, // não
      { predicted: 7, actual: 8 }, // relevante
      { predicted: 6, actual: 5 },
    ]
    // top-2 por previsão: actuals 9 e 6 → 1 relevante / 2 = 0.5
    expect(precisionAtK(pairs, 2, 8)).toBe(0.5)
  })
  it("Regret@k = 0 quando a previsão escolhe o ótimo", () => {
    expect(regretAtK(perfect, 2)).toBeCloseTo(0, 6)
  })
  it("Regret@k > 0 quando a previsão erra a escolha", () => {
    const pairs: RankedPair[] = [
      { predicted: 10, actual: 1 }, // previsão coloca no topo, mas é ruim
      { predicted: 1, actual: 10 }, // previsão rebaixa, mas é ótimo
    ]
    // ótimo top-1 = 10; escolhido top-1 = 1 → regret 9
    expect(regretAtK(pairs, 1)).toBeCloseTo(9, 6)
  })
})

describe("computeRankingMetrics", () => {
  it("agrega tudo num grupo e reporta count", () => {
    const m = computeRankingMetrics(perfect)
    expect(m.count).toBe(4)
    expect(m.spearman).toBeCloseTo(1, 6)
    expect(m.pairwiseAccuracy).toBe(1)
    expect(m.ndcgAt5).toBeCloseTo(1, 6)
  })
})
