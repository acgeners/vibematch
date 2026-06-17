import { describe, it, expect } from "vitest"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"

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
