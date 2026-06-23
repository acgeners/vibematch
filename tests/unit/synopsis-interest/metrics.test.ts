import { describe, it, expect } from "vitest"
import {
  levelOf,
  ordinalAgreement,
  quadraticWeightedKappa,
  spearman,
  pairwiseAccuracy,
  ndcgAtK,
  topKOverlap,
  intraRaterConsistency,
} from "@/lib/synopsis-interest/metrics"

describe("levelOf", () => {
  it("mapeia ♥..♥♥♥♥ → 1..4; desconhecido → 0", () => {
    expect(levelOf("♥")).toBe(1)
    expect(levelOf("♥♥♥♥")).toBe(4)
    expect(levelOf(null)).toBe(0)
    expect(levelOf("x")).toBe(0)
  })
})

describe("ordinalAgreement", () => {
  it("perfeito → exact 1, mae 0, qwk 1", () => {
    const r = ordinalAgreement([{ pred: 1, gold: 1 }, { pred: 3, gold: 3 }, { pred: 4, gold: 4 }])
    expect(r.exactRate).toBe(1)
    expect(r.mae).toBe(0)
    expect(r.bias).toBe(0)
    expect(r.qwk).toBe(1)
  })
  it("calcula within1, mae e viés", () => {
    const r = ordinalAgreement([{ pred: 2, gold: 1 }, { pred: 4, gold: 2 }])
    expect(r.within1Rate).toBe(0.5) // só o primeiro está dentro de ±1
    expect(r.mae).toBe((1 + 2) / 2)
    expect(r.bias).toBe((1 + 2) / 2) // superestima
  })
  it("ignora pares sem nível válido", () => {
    const r = ordinalAgreement([{ pred: 0, gold: 3 }, { pred: 2, gold: 2 }])
    expect(r.n).toBe(1)
  })
})

describe("quadraticWeightedKappa", () => {
  it("acordo pior que o acaso → negativo", () => {
    const k = quadraticWeightedKappa([
      { pred: 1, gold: 4 }, { pred: 4, gold: 1 }, { pred: 1, gold: 4 }, { pred: 4, gold: 1 },
    ])
    expect(k!).toBeLessThan(0)
  })
})

describe("spearman", () => {
  it("monotônico crescente → 1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
  })
  it("monotônico decrescente → -1", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1)
  })
  it("lida com empates (ranks médios)", () => {
    const r = spearman([1, 1, 2, 3], [5, 5, 6, 7])
    expect(r).toBeCloseTo(1)
  })
})

describe("pairwiseAccuracy", () => {
  it("ordem perfeita → 1; invertida → 0", () => {
    const items = [{ score: 1, truth: 1 }, { score: 2, truth: 2 }, { score: 3, truth: 3 }]
    expect(pairwiseAccuracy(items)).toBe(1)
    expect(pairwiseAccuracy(items.map((i) => ({ score: -i.score, truth: i.truth })))).toBe(0)
  })
  it("ignora pares com empate na verdade", () => {
    expect(pairwiseAccuracy([{ score: 1, truth: 5 }, { score: 2, truth: 5 }])).toBeNull()
  })
})

describe("ndcgAtK / topKOverlap", () => {
  it("ndcg da ordenação ideal → 1", () => {
    expect(ndcgAtK([3, 2, 1, 0], 4)).toBeCloseTo(1)
  })
  it("ndcg pior quando relevantes vão pro fim", () => {
    expect(ndcgAtK([0, 1, 2, 3], 4)!).toBeLessThan(1)
  })
  it("topKOverlap conta interseção do topo", () => {
    expect(topKOverlap(["a", "b", "c"], ["a", "b", "x"], 3)).toBeCloseTo(2 / 3)
  })
})

describe("intraRaterConsistency", () => {
  it("repetições idênticas → exact 1", () => {
    const r = intraRaterConsistency([{ a: 2, b: 2 }, { a: 4, b: 4 }])
    expect(r.exactRate).toBe(1)
    expect(r.mae).toBe(0)
  })
  it("dentro de ±1 conta em within1", () => {
    const r = intraRaterConsistency([{ a: 2, b: 3 }, { a: 1, b: 4 }])
    expect(r.within1Rate).toBe(0.5)
  })
})
