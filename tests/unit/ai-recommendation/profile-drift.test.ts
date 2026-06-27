import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import {
  compareFingerprints,
  computeHeuristicFingerprint,
  type HeuristicFingerprint,
} from "@/lib/ai-recommendation/profile-drift"
import type { RatedWorkInput } from "@/lib/ai-recommendation/types"

const fp = (loved: string[], avoided: string[]): HeuristicFingerprint => ({ loved, avoided, criteria: [] })

describe("profile-drift — compareFingerprints (math)", () => {
  it("idênticos → drift 0, Jaccard 1, 0 tags mudaram", () => {
    const c = compareFingerprints(fp(["a", "b"], ["x"]), fp(["a", "b"], ["x"]))
    expect(c.driftPct).toBe(0)
    expect(c.lovedJaccard).toBe(1)
    expect(c.avoidedJaccard).toBe(1)
    expect(c.changedTags).toBe(0)
  })

  it("disjuntos → drift 1, Jaccard 0, todas mudaram", () => {
    const c = compareFingerprints(fp(["a"], ["x"]), fp(["b"], ["y"]))
    expect(c.driftPct).toBe(1)
    expect(c.lovedJaccard).toBe(0)
    expect(c.avoidedJaccard).toBe(0)
    expect(c.changedTags).toBe(4)
  })

  it("overlap parcial", () => {
    // loved {a,b}×{b,c}: inter 1 / union 3 = 1/3; avoided idênticos = 1
    const c = compareFingerprints(fp(["a", "b"], ["x"]), fp(["b", "c"], ["x"]))
    expect(c.lovedJaccard).toBeCloseTo(1 / 3, 6)
    expect(c.avoidedJaccard).toBe(1)
    expect(c.driftPct).toBeCloseTo(1 - (1 / 3 + 1) / 2, 6)
    expect(c.changedTags).toBe(2) // 'a' saiu, 'c' entrou
  })

  it("ambos vazios → drift 0 (Jaccard de conjuntos vazios = 1)", () => {
    expect(compareFingerprints(fp([], []), fp([], [])).driftPct).toBe(0)
  })
})

describe("profile-drift — computeHeuristicFingerprint (estrutura + determinismo)", () => {
  const work = (id: string, score: number, tags: string[]): RatedWorkInput => ({
    id, title: id, userScore: score, postScores: {}, personalStatus: null, synopsis: null,
    categoryScores: {}, tags: tags.map((name) => ({ name, group: null })),
  })
  const works: RatedWorkInput[] = [
    work("1", 9, ["Action", "Romance"]),
    work("2", 9, ["Action", "Drama"]),
    work("3", 8, ["Romance", "Comedy"]),
    work("4", 3, ["Horror", "Gore"]),
    work("5", 2, ["Horror", "Tragedy"]),
    work("6", 9, ["Action", "Romance"]),
  ]

  it("é determinístico", () => {
    expect(computeHeuristicFingerprint(works)).toEqual(computeHeuristicFingerprint(works))
  })

  it("loved/avoided são lowercased, ordenados e sem duplicatas", () => {
    const f = computeHeuristicFingerprint(works)
    for (const arr of [f.loved, f.avoided]) {
      expect(arr).toEqual([...arr].sort())
      expect(arr.every((t) => t === t.toLowerCase())).toBe(true)
      expect(new Set(arr).size).toBe(arr.length)
    }
    expect(Array.isArray(f.criteria)).toBe(true)
  })
})
