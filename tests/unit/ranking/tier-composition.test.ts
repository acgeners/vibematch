import { describe, it, expect } from "vitest"
import {
  archetypesOf,
  compositionOf,
  ARCHETYPE_ORDER,
  ARCHETYPE_LABEL,
} from "@/lib/ranking/tier-composition"
import type { CompositionInput, ForceArchetype } from "@/lib/ranking/tier-composition"

const work = (o: Partial<CompositionInput> = {}): CompositionInput => ({
  chanceScore: 60,
  platformAvg: 8,
  totalVotes: 1000,
  ...o,
})

describe("archetypesOf", () => {
  it("classifica pelo cruzamento Chance × Avaliação (median split)", () => {
    const items = [
      work({ chanceScore: 90, platformAvg: 9 }), // fit alto + crítica alta
      work({ chanceScore: 90, platformAvg: 6 }), // fit alto + crítica baixa
      work({ chanceScore: 20, platformAvg: 9 }), // fit baixo + crítica alta
      work({ chanceScore: 20, platformAvg: 6 }), // fit baixo + crítica baixa
    ]
    expect(archetypesOf(items)).toEqual(["safe", "niche", "upside", "skip"])
  })

  it("é RELATIVO ao conjunto exibido, não a um limiar absoluto", () => {
    // As mesmas notas viram arquétipos diferentes conforme a companhia: num
    // conjunto fraco, 60/7,5 é a melhor aposta; num forte, é a pior.
    const alvo = work({ chanceScore: 60, platformAvg: 7.5 })
    const fraco = [alvo, work({ chanceScore: 20, platformAvg: 5 }), work({ chanceScore: 25, platformAvg: 5.5 })]
    const forte = [alvo, work({ chanceScore: 95, platformAvg: 9.5 }), work({ chanceScore: 90, platformAvg: 9 })]
    expect(archetypesOf(fraco)[0]).toBe("safe")
    expect(archetypesOf(forte)[0]).toBe("skip")
  })

  it("devolve null quando faltam AS DUAS forças que definem a aposta", () => {
    const semNada = work({ chanceScore: null, platformAvg: null })
    expect(archetypesOf([semNada, work()])[0]).toBeNull()
  })

  it("classifica com uma força só, quando a outra existe", () => {
    const items = [work({ chanceScore: null, platformAvg: 9 }), work({ platformAvg: 5 }), work({ platformAvg: 5 })]
    expect(archetypesOf(items)[0]).not.toBeNull()
  })

  it("preserva a ordem de entrada", () => {
    const items = [work({ chanceScore: 20 }), work({ chanceScore: 90 }), work({ chanceScore: 50 })]
    const out = archetypesOf(items)
    expect(out).toHaveLength(3)
    // a 2ª tem a maior chance do conjunto → tem que estar no lado "fit alto"
    expect(out[1] === "safe" || out[1] === "niche").toBe(true)
    expect(out[0] === "upside" || out[0] === "skip").toBe(true)
  })

  it("conjunto homogêneo não quebra (percentil 50 pra todo mundo)", () => {
    const out = archetypesOf([work(), work(), work()])
    expect(out).toHaveLength(3)
    expect(out.every((a) => a !== null)).toBe(true)
  })

  it("lista vazia devolve lista vazia", () => {
    expect(archetypesOf([])).toEqual([])
  })
})

describe("compositionOf", () => {
  it("conta por arquétipo e devolve em ARCHETYPE_ORDER", () => {
    const c = compositionOf(["upside", "safe", "niche", "safe", "skip", "upside", "upside"])
    expect(c).toEqual([
      { archetype: "safe", count: 2 },
      { archetype: "upside", count: 3 },
      { archetype: "niche", count: 1 },
      { archetype: "skip", count: 1 },
    ])
  })

  it("OMITE os zerados — um chip '0 vale o risco' só ocuparia espaço", () => {
    const c = compositionOf(["safe", "safe"])
    expect(c).toEqual([{ archetype: "safe", count: 2 }])
  })

  it("ignora os null em vez de contá-los como um tipo", () => {
    const c = compositionOf(["safe", null, null, "safe"])
    expect(c).toEqual([{ archetype: "safe", count: 2 }])
  })

  it("a soma das contagens é o total classificado do grupo", () => {
    const arch: (ForceArchetype | null)[] = ["safe", "upside", "niche", "skip", null]
    const total = compositionOf(arch).reduce((s, x) => s + x.count, 0)
    expect(total).toBe(4)
  })

  it("grupo sem nada classificado devolve vazio (o divisor volta ao de antes)", () => {
    expect(compositionOf([null, null])).toEqual([])
  })
})

describe("vocabulário", () => {
  it("todo arquétipo de ARCHETYPE_ORDER tem rótulo", () => {
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPE_LABEL[a]).toBeTruthy()
    }
  })

  it("ARCHETYPE_ORDER cobre os 4, sem repetir", () => {
    expect(new Set(ARCHETYPE_ORDER).size).toBe(4)
    expect(Object.keys(ARCHETYPE_LABEL).sort()).toEqual(["niche", "safe", "skip", "upside"])
  })
})
