import { describe, it, expect } from "vitest"
import {
  computeBase2r1Signature,
  computeBase2Signature,
  computeReviewCorpusAggregateSignature,
  computeDigestSelectionAggregateSignature,
  diffBase2Overlay,
  diffArtifactJson,
  median,
  BASE2R1_SNAPSHOT_KIND,
  type Base2r1Versions,
  type Base2OverlayIdentity,
} from "@/lib/synopsis-interest/base2r1"

const V: Base2r1Versions = {
  goldenVersion: "pilot-2",
  baseSnapshotVersion: "base-2r1",
  snapshotKind: BASE2R1_SNAPSHOT_KIND,
  corpusPolicyVersion: "text-only-v1",
  derivedFrom: { base: "base-2", base2Signature: "9d181e86" },
  tasteProfileVersion: "v7",
  schemaVersion: "v1",
}
type WorkSig = { workId: string; reviewCorpusSignature: string; digestSelectionSignature: string }
const ws = (over: WorkSig[]) => over

describe("base2r1 — assinatura (vinculada ao base-2)", () => {
  it("order-independent nas obras", () => {
    const a = computeBase2r1Signature(V, ws([
      { workId: "b", reviewCorpusSignature: "s2", digestSelectionSignature: "d2" },
      { workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" },
    ]))
    const b = computeBase2r1Signature(V, ws([
      { workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" },
      { workId: "b", reviewCorpusSignature: "s2", digestSelectionSignature: "d2" },
    ]))
    expect(a).toBe(b)
  })
  it("base2Signature MUDA ⇒ base2r1Signature muda (binding ao base-2)", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    const changed = computeBase2r1Signature(
      { ...V, derivedFrom: { base: "base-2", base2Signature: "OUTRO" } },
      ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]),
    )
    expect(changed).not.toBe(base)
  })
  it("snapshotKind/snapshotVersion entram na assinatura", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    expect(computeBase2r1Signature({ ...V, snapshotKind: "outro" }, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))).not.toBe(base)
    expect(computeBase2r1Signature({ ...V, baseSnapshotVersion: "base-2r2" }, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))).not.toBe(base)
  })
  it("muda com a política do corpus", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    expect(computeBase2r1Signature({ ...V, corpusPolicyVersion: "text-only-v2" }, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))).not.toBe(base)
  })
  it("muda quando o corpus de UMA obra muda", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    expect(computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "CHANGED", digestSelectionSignature: "d1" }]))).not.toBe(base)
  })
  it("muda quando a SELEÇÃO (≤40) de uma obra muda", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    expect(computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "CHANGED" }]))).not.toBe(base)
  })
  it("muda quando uma obra é add/removida/substituída", () => {
    const base = computeBase2r1Signature(V, ws([{ workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    const added = computeBase2r1Signature(V, ws([
      { workId: "a", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" },
      { workId: "b", reviewCorpusSignature: "s2", digestSelectionSignature: "d2" },
    ]))
    const replaced = computeBase2r1Signature(V, ws([{ workId: "z", reviewCorpusSignature: "s1", digestSelectionSignature: "d1" }]))
    expect(added).not.toBe(base)
    expect(replaced).not.toBe(base)
  })
})

describe("base2r1 — agregados", () => {
  it("reviewCorpusAggregate independe da ordem das obras", () => {
    const a = computeReviewCorpusAggregateSignature("text-only-v1", [
      { workId: "b", reviewCorpusSignature: "s2" }, { workId: "a", reviewCorpusSignature: "s1" },
    ])
    const b = computeReviewCorpusAggregateSignature("text-only-v1", [
      { workId: "a", reviewCorpusSignature: "s1" }, { workId: "b", reviewCorpusSignature: "s2" },
    ])
    expect(a).toBe(b)
  })
  it("digestSelectionAggregate muda se a seleção de uma obra mudar", () => {
    const base = computeDigestSelectionAggregateSignature("text-only-v1", [{ workId: "a", digestSelectionSignature: "d1" }])
    expect(computeDigestSelectionAggregateSignature("text-only-v1", [{ workId: "a", digestSelectionSignature: "d2" }])).not.toBe(base)
  })
  it("agregados mudam com a política", () => {
    const c1 = computeReviewCorpusAggregateSignature("text-only-v1", [{ workId: "a", reviewCorpusSignature: "s1" }])
    const c2 = computeReviewCorpusAggregateSignature("text-only-v2", [{ workId: "a", reviewCorpusSignature: "s1" }])
    expect(c1).not.toBe(c2)
  })
})

describe("base2r1 — validação de integridade do base-2", () => {
  it("computeBase2Signature é determinística e order-sensitive (ordem de arquivo)", () => {
    const w1 = { workId: "a", canonicalSynopsis: "S", tags: ["y", "x"], split: "development", stratum: "♥" }
    const w2 = { workId: "b", canonicalSynopsis: "T", tags: ["z"], split: "holdout", stratum: "♥♥" }
    const sig = computeBase2Signature([w1, w2])
    expect(sig).toBe(computeBase2Signature([{ ...w1, tags: ["x", "y"] }, w2])) // tags ordenadas internamente
    expect(computeBase2Signature([w2, w1])).not.toBe(sig) // ordem das obras importa
  })
  it("muda se a sinopse mudar", () => {
    const base = computeBase2Signature([{ workId: "a", canonicalSynopsis: "S", tags: [], split: "development", stratum: "♥" }])
    expect(computeBase2Signature([{ workId: "a", canonicalSynopsis: "OUTRA", tags: [], split: "development", stratum: "♥" }])).not.toBe(base)
  })
})

describe("base2r1 — diff REAL Projeção A × B", () => {
  const w = (over: Partial<Base2OverlayIdentity> = {}): Base2OverlayIdentity => ({
    workId: "a", origin: "new", split: "development", stratum: "♥♥", title: "T", canonicalIndex: 0, ...over,
  })
  const A = [w({ workId: "a", canonicalIndex: 0 }), w({ workId: "b", canonicalIndex: 1 })]

  it("idênticas ⇒ setEqual, fieldEqual, 0 bloqueantes", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", canonicalIndex: 0 }), w({ workId: "b", canonicalIndex: 1 })])
    expect(d.setEqual).toBe(true)
    expect(d.fieldEqual).toBe(true)
    expect(d.blockingDifferences).toEqual([])
    expect(d.identicalWorks).toBe(2)
  })

  // ── Adulteração campo-a-campo da Projeção B ⇒ diff BLOQUEIA ──
  it("detecta origin divergente", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", origin: "carryover" }), w({ workId: "b", canonicalIndex: 1 })])
    expect(d.blockingDifferences.length).toBeGreaterThan(0)
    expect(d.fieldDifferences.some((s) => s.includes(".origin"))).toBe(true)
  })
  it("detecta split divergente", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", split: "holdout" }), w({ workId: "b", canonicalIndex: 1 })])
    expect(d.fieldDifferences.some((s) => s.includes(".split"))).toBe(true)
  })
  it("detecta stratum divergente", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", stratum: "♥" }), w({ workId: "b", canonicalIndex: 1 })])
    expect(d.fieldDifferences.some((s) => s.includes(".stratum"))).toBe(true)
  })
  it("detecta título divergente", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", title: "X" }), w({ workId: "b", canonicalIndex: 1 })])
    expect(d.fieldDifferences.some((s) => s.includes(".title"))).toBe(true)
  })
  it("detecta reordenação (canonicalIndex divergente)", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", canonicalIndex: 1 }), w({ workId: "b", canonicalIndex: 0 })])
    expect(d.fieldDifferences.some((s) => s.includes(".canonicalIndex"))).toBe(true)
  })
  it("detecta work_id substituído / obra removida / extra", () => {
    const removed = diffBase2Overlay(A, [w({ workId: "a", canonicalIndex: 0 })])
    expect(removed.setEqual).toBe(false)
    expect(removed.missingWorkIds).toEqual(["b"])
    const substituted = diffBase2Overlay(A, [w({ workId: "a", canonicalIndex: 0 }), w({ workId: "z", canonicalIndex: 1 })])
    expect(substituted.missingWorkIds).toEqual(["b"])
    expect(substituted.extraWorkIds).toEqual(["z"])
    expect(substituted.blockingDifferences.length).toBeGreaterThan(0)
  })
  it("detecta work_id duplicado", () => {
    const d = diffBase2Overlay(A, [w({ workId: "a", canonicalIndex: 0 }), w({ workId: "a", canonicalIndex: 1 })])
    expect(d.duplicateWorkIds).toEqual(["a"])
    expect(d.setEqual).toBe(false)
  })
})

describe("base2r1 — diffArtifactJson (modo verify detecta adulteração)", () => {
  it("idêntico ⇒ [] (reprodutível)", () => {
    const j = JSON.stringify({ a: 1, b: [1, 2], base2r1Signature: "x" })
    expect(diffArtifactJson(j, j)).toEqual([])
  })
  it("artefato adulterado ⇒ lista a chave divergente", () => {
    const disk = JSON.stringify({ base2r1Signature: "ADULTERADO", n: 90 })
    const rebuilt = JSON.stringify({ base2r1Signature: "ok", n: 90 })
    expect(diffArtifactJson(disk, rebuilt)).toEqual(["base2r1Signature"])
  })
  it("artefato ausente/inválido ⇒ divergência total", () => {
    expect(diffArtifactJson("", JSON.stringify({ a: 1 })).length).toBeGreaterThan(0)
  })
})

describe("base2r1 — median", () => {
  it("ímpar e par", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})
