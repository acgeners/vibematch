import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import {
  compareFingerprints,
  computeHeuristicFingerprint,
  classifyProfileStaleness,
  PROFILE_DRIFT_THRESHOLD,
  PROFILE_STALE_FRACTION_NEW,
  PROFILE_STALE_AGE_DAYS,
  type HeuristicFingerprint,
  type ProfileStalenessArgs,
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

describe("profile-drift — classifyProfileStaleness (gate composto)", () => {
  const NOW = Date.parse("2026-07-05T00:00:00.000Z")
  const RECENT = "2026-07-01T00:00:00.000Z" // ~4 dias
  const base = (over: Partial<ProfileStalenessArgs> = {}): ProfileStalenessArgs => ({
    savedFingerprint: fp(["a", "b"], ["x"]),
    currentFingerprint: fp(["a", "b"], ["x"]),
    savedInputHash: "H0",
    currentInputHash: "H0",
    savedNWorks: 100,
    currentNWorks: 100,
    savedCreatedAt: RECENT,
    nowMs: NOW,
    ...over,
  })

  it("biblioteca idêntica (input_hash igual) ⇒ fresh, sem medir drift", () => {
    const r = classifyProfileStaleness(base())
    expect(r.stale).toBe(false)
    expect(r.reason).toBe("identical")
  })

  it("input mudou mas gosto IMATERIAL (fingerprint igual) ⇒ fresh — o ponto central", () => {
    const r = classifyProfileStaleness(base({ savedInputHash: "H0", currentInputHash: "H1" }))
    expect(r.stale).toBe(false)
    expect(r.reason).toBe("fresh")
    expect(r.driftPct).toBe(0)
  })

  it("drift ≥ θ ⇒ stale (drift)", () => {
    const r = classifyProfileStaleness(
      base({ currentInputHash: "H1", savedFingerprint: fp(["a", "b", "c", "d"], []), currentFingerprint: fp(["w", "x", "y", "z"], []) }),
    )
    expect(r.driftPct).toBeGreaterThanOrEqual(PROFILE_DRIFT_THRESHOLD)
    expect(r.stale).toBe(true)
    expect(r.reason).toBe("drift")
  })

  it("drift logo abaixo de θ ⇒ ainda fresh (liberal)", () => {
    // 1 de 8 tags amadas trocada ⇒ Jaccard 7/9≈0.78 ⇒ drift≈0.11 < 0.15.
    const saved = fp(["a", "b", "c", "d", "e", "f", "g", "h"], [])
    const cur = fp(["a", "b", "c", "d", "e", "f", "g", "Z"], [])
    const r = classifyProfileStaleness(base({ currentInputHash: "H1", savedFingerprint: saved, currentFingerprint: cur }))
    expect(r.driftPct).toBeLessThan(PROFILE_DRIFT_THRESHOLD)
    expect(r.stale).toBe(false)
  })

  it("teto de FRAÇÃO: cresceu além do limite ⇒ stale mesmo com drift baixo", () => {
    const grown = Math.ceil(100 * (PROFILE_STALE_FRACTION_NEW + 0.01)) + 100
    const r = classifyProfileStaleness(base({ currentInputHash: "H1", currentNWorks: grown }))
    expect(r.stale).toBe(true)
    expect(r.reason).toBe("fraction_new")
  })

  it("teto de IDADE: perfil velho ⇒ stale mesmo idêntico", () => {
    const old = new Date(NOW - (PROFILE_STALE_AGE_DAYS + 5) * 86_400_000).toISOString()
    const r = classifyProfileStaleness(base({ savedCreatedAt: old }))
    expect(r.stale).toBe(true)
    expect(r.reason).toBe("age")
  })

  it("fallback LEGADO: sem fingerprint + input mudou ⇒ stale (comportamento antigo)", () => {
    const r = classifyProfileStaleness(base({ savedFingerprint: null, currentInputHash: "H1" }))
    expect(r.stale).toBe(true)
    expect(r.reason).toBe("legacy_hash")
  })

  it("fallback LEGADO: sem fingerprint mas input igual ⇒ fresh", () => {
    const r = classifyProfileStaleness(base({ savedFingerprint: null }))
    expect(r.stale).toBe(false)
    expect(r.reason).toBe("identical")
  })
})
