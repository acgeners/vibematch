import { describe, it, expect } from "vitest"
import { buildRankingTiers, compareWithinTierTieBreak } from "@/lib/ranking/build-tiers"

interface Item {
  id: string
  score: number | null | undefined
}
const get = (x: Item) => x.score
const tiersOf = (items: Item[], band: number) =>
  buildRankingTiers(items, get, band).map((t) => t.tier)

describe("buildRankingTiers", () => {
  it("agrupa ancorado na 1ª obra (não encadeia)", () => {
    // 8.0↔7.7=0.3 e 7.7↔7.4=0.3, mas 8.0↔7.4=0.6 > 0.5 → NÃO ficam os três juntos.
    const items: Item[] = [
      { id: "a", score: 8.0 },
      { id: "b", score: 7.7 },
      { id: "c", score: 7.4 },
    ]
    expect(tiersOf(items, 0.5)).toEqual([1, 1, 2])
  })

  it("limite EXATO é inclusivo (anchor - score <= band fica no tier)", () => {
    // 8.0-7.5 = 0.5 (<=0.5 → mesmo tier); 8.0-7.0 = 1.0 (> 0.5 → novo tier).
    expect(tiersOf([{ id: "a", score: 8.0 }, { id: "b", score: 7.5 }, { id: "c", score: 7.0 }], 0.5)).toEqual([1, 1, 2])
  })

  it("valores repetidos no mesmo tier", () => {
    expect(tiersOf([{ id: "a", score: 8.0 }, { id: "b", score: 8.0 }, { id: "c", score: 7.9 }], 0.5)).toEqual([1, 1, 1])
  })

  it("scores inválidos (null/undefined/NaN/Infinity) vão pro último tier sem quebrar os demais", () => {
    const items: Item[] = [
      { id: "a", score: 8.0 },
      { id: "b", score: null },
      { id: "c", score: 7.9 },
      { id: "d", score: NaN },
      { id: "e", score: undefined },
      { id: "f", score: Infinity },
    ]
    // válidos: a(8.0)=t1, c(7.9)=t1; inválidos (b,d,e,f) = t2.
    expect(tiersOf(items, 0.5)).toEqual([1, 2, 1, 2, 2, 2])
  })

  it("não depende da ordem de entrada (computa por score, devolve alinhado à entrada)", () => {
    const items: Item[] = [
      { id: "c", score: 7.4 },
      { id: "a", score: 8.0 },
      { id: "b", score: 7.7 },
    ]
    // por score: 8.0=t1, 7.7=t1, 7.4=t2 → alinhado: c=2, a=1, b=1.
    expect(tiersOf(items, 0.5)).toEqual([2, 1, 1])
  })

  it("lista vazia → []", () => {
    expect(buildRankingTiers([], get, 0.5)).toEqual([])
  })

  it("uma única obra → tier 1", () => {
    expect(tiersOf([{ id: "a", score: 8.0 }], 0.5)).toEqual([1])
  })

  it("preserva os itens originais", () => {
    const items: Item[] = [{ id: "a", score: 8.0 }, { id: "b", score: 6.0 }]
    const out = buildRankingTiers(items, get, 0.5)
    expect(out[0].item).toBe(items[0])
    expect(out[1].item).toBe(items[1])
  })

  it("banda inválida (0, negativa, acima do máximo) → lança", () => {
    const items: Item[] = [{ id: "a", score: 8.0 }]
    expect(() => buildRankingTiers(items, get, 0)).toThrow()
    expect(() => buildRankingTiers(items, get, -0.5)).toThrow()
    expect(() => buildRankingTiers(items, get, 3)).toThrow()
    expect(() => buildRankingTiers(items, get, NaN)).toThrow()
  })

  it("banda maior junta mais obras (0.3 vs 0.5)", () => {
    const items: Item[] = [{ id: "a", score: 8.0 }, { id: "b", score: 7.6 }, { id: "c", score: 7.3 }]
    // 0.3: 8.0-7.6=0.4>0.3 → a=t1,b=t2; 7.6-7.3=0.3 → mas anchor é b(7.6): 7.6-7.3=0.3<=0.3 → c=t2.
    expect(tiersOf(items, 0.3)).toEqual([1, 2, 2])
    // 0.5: 8.0-7.6=0.4<=0.5 → b=t1; 8.0-7.3=0.7>0.5 → c=t2.
    expect(tiersOf(items, 0.5)).toEqual([1, 1, 2])
  })
})

describe("compareWithinTierTieBreak", () => {
  type E = { id: string; tagOverlapNet: number | null; expectedScore: number | null }
  const order = (es: E[]) => [...es].sort(compareWithinTierTieBreak).map((e) => e.id)

  it("ordena por tagOverlapNet desc", () => {
    expect(order([
      { id: "lo", tagOverlapNet: 1, expectedScore: 9 },
      { id: "hi", tagOverlapNet: 5, expectedScore: 8 },
      { id: "mid", tagOverlapNet: 3, expectedScore: 7 },
    ])).toEqual(["hi", "mid", "lo"])
  })

  it("empate em tagOverlapNet → desempata por expectedScore desc", () => {
    expect(order([
      { id: "a", tagOverlapNet: 2, expectedScore: 7.2 },
      { id: "b", tagOverlapNet: 2, expectedScore: 7.8 },
    ])).toEqual(["b", "a"])
  })

  it("tagOverlapNet null afunda para o fim do tier", () => {
    expect(order([
      { id: "null", tagOverlapNet: null, expectedScore: 9.9 },
      { id: "low", tagOverlapNet: -3, expectedScore: 1 },
    ])).toEqual(["low", "null"])
  })

  it("ambos null → ordena por expectedScore desc", () => {
    expect(order([
      { id: "a", tagOverlapNet: null, expectedScore: 7 },
      { id: "b", tagOverlapNet: null, expectedScore: 8 },
    ])).toEqual(["b", "a"])
  })

  it("NaN/Infinity tratados como ausência", () => {
    expect(order([
      { id: "nan", tagOverlapNet: NaN, expectedScore: 9 },
      { id: "ok", tagOverlapNet: 0, expectedScore: 1 },
    ])).toEqual(["ok", "nan"])
  })
})
