import { describe, it, expect } from "vitest"
import {
  buildSnapshotBase,
  buildSnapshotBaseWork,
  buildSnapshotManifest,
  computeReviewCorpusSignature,
  type SnapshotBaseWorkInput,
} from "@/lib/synopsis-interest/snapshot"

function input(over: Partial<SnapshotBaseWorkInput> = {}): SnapshotBaseWorkInput {
  return {
    workId: "w-1",
    slots: [{ slotKey: "S001", isRepeat: false, repeatOf: null }],
    split: "development",
    stratum: "♥♥♥",
    title: "A Work",
    canonicalSynopsis: "A heroine navigates a slow burn romance.",
    tags: ["romance", "isekai"],
    tagsRecoverable: false,
    tasteProfileSignature: "profile:v7",
    reviews: [{ source: "anilist", text: "x".repeat(50) }],
    reviewSources: ["anilist"],
    summaryPresent: true,
    summaryFresh: true,
    digestPresent: false,
    digestFresh: false,
    latestFetchedAt: "2026-06-15T00:00:00Z",
    ...over,
  }
}

describe("snapshot — review corpus signature", () => {
  it("order-independent", () => {
    const a = computeReviewCorpusSignature([{ source: "a", text: "t1" }, { source: "b", text: "t2" }])
    const b = computeReviewCorpusSignature([{ source: "b", text: "t2" }, { source: "a", text: "t1" }])
    expect(a).toBe(b)
  })
  it("muda quando o corpus muda", () => {
    const a = computeReviewCorpusSignature([{ source: "a", text: "t1" }])
    const b = computeReviewCorpusSignature([{ source: "a", text: "t1-changed" }])
    expect(a).not.toBe(b)
  })
})

describe("snapshot — buildSnapshotBaseWork", () => {
  it("frozen_current quando há reviews úteis; no_reviews quando não há", () => {
    expect(buildSnapshotBaseWork(input()).reviewState).toBe("frozen_current")
    expect(buildSnapshotBaseWork(input({ reviews: [], reviewSources: [] })).reviewState).toBe("no_reviews")
  })
  it("S078: tags=[] recoverable → missing_recoverable_frozen_empty", () => {
    const w = buildSnapshotBaseWork(input({ tags: [], tagsRecoverable: true }))
    expect(w.tagContextType).toBe("missing_recoverable_frozen_empty")
    expect(w.tags).toEqual([])
  })
  it("no_tags legítimo tem assinatura DISTINTA de S078 (recoverable)", () => {
    const legit = buildSnapshotBaseWork(input({ tags: [], tagsRecoverable: false }))
    const s078 = buildSnapshotBaseWork(input({ tags: [], tagsRecoverable: true }))
    expect(legit.tagsSignature).not.toBe(s078.tagsSignature)
    expect(legit.baseInputSignature).not.toBe(s078.baseInputSignature)
  })
  it("loading_error (tags=null) lança — nunca assina", () => {
    expect(() => buildSnapshotBaseWork(input({ tags: null }))).toThrow(/loading_error/)
  })
})

describe("snapshot — baseInputSignature ignora reviews", () => {
  it("b1 idêntico com/sem reviews (mesmo título/sinopse/tags/perfil)", () => {
    const a = buildSnapshotBaseWork(input({ reviews: [{ source: "a", text: "y".repeat(50) }] }))
    const b = buildSnapshotBaseWork(input({ reviews: [], reviewSources: [], summaryPresent: false, summaryFresh: false }))
    expect(a.baseInputSignature).toBe(b.baseInputSignature)
  })
  it("e1 (provisório) difere com/sem reviews", () => {
    const a = buildSnapshotBaseWork(input({ reviews: [{ source: "a", text: "y".repeat(50) }], summaryPresent: true, summaryFresh: true }))
    const b = buildSnapshotBaseWork(input({ reviews: [], reviewSources: [], summaryPresent: false, summaryFresh: false }))
    expect(a.provisionalEnrichedInputSignature).not.toBe(b.provisionalEnrichedInputSignature)
  })
})

describe("snapshot — buildSnapshotBase", () => {
  const inputs = [
    input({ workId: "w-3", slots: [{ slotKey: "S003", isRepeat: false, repeatOf: null }] }),
    input({ workId: "w-1", slots: [{ slotKey: "S001", isRepeat: false, repeatOf: null }] }),
    input({ workId: "w-2", slots: [{ slotKey: "S002", isRepeat: false, repeatOf: null }, { slotKey: "R001", isRepeat: true, repeatOf: "S002" }] }),
  ]

  it("ordena por workId; assinatura order-independent", () => {
    const a = buildSnapshotBase(inputs, "2026-06-19T00:00:00Z")
    const b = buildSnapshotBase([...inputs].reverse(), "2026-06-19T09:99:99Z")
    expect(a.works.map((w) => w.workId)).toEqual(["w-1", "w-2", "w-3"])
    expect(a.snapshotBaseSignature).toBe(b.snapshotBaseSignature) // capturedAt não entra
  })
  it("mudança de sinopse muda a assinatura; mudança de perfil também", () => {
    const base = buildSnapshotBase(inputs, "t")
    const syn = buildSnapshotBase([input({ workId: "w-1", canonicalSynopsis: "X" }), ...inputs.slice(1)], "t")
    expect(base.snapshotBaseSignature).not.toBe(syn.snapshotBaseSignature)
    const prof = buildSnapshotBase(inputs.map((i) => ({ ...i, tasteProfileSignature: "other" })), "t")
    expect(base.snapshotBaseSignature).not.toBe(prof.snapshotBaseSignature)
  })
  it("mudança no corpus de reviews muda a snapshot signature", () => {
    const base = buildSnapshotBase(inputs, "t")
    const changed = buildSnapshotBase([input({ workId: "w-1", reviews: [{ source: "a", text: "z".repeat(60) }] }), ...inputs.slice(1)], "t")
    expect(base.reviewCorpusSignature).not.toBe(changed.reviewCorpusSignature)
    expect(base.snapshotBaseSignature).not.toBe(changed.snapshotBaseSignature)
  })
})

describe("snapshot — manifest (sem conteúdo integral)", () => {
  it("conta obras/slots/repeats/strata e NÃO inclui sinopse/tags integrais", () => {
    const snap = buildSnapshotBase([
      input({ workId: "w-1", slots: [{ slotKey: "S001", isRepeat: false, repeatOf: null }, { slotKey: "R001", isRepeat: true, repeatOf: "S001" }] }),
      input({ workId: "w-2", slots: [{ slotKey: "S002", isRepeat: false, repeatOf: null }], tags: [], tagsRecoverable: true }),
    ], "t")
    const m = buildSnapshotManifest(snap)
    expect(m.uniqueWorks).toBe(2)
    expect(m.totalSlots).toBe(3)
    expect(m.repeats).toBe(1)
    expect(m.tagContextCounts["missing_recoverable_frozen_empty"]).toBe(1)
    const json = JSON.stringify(m)
    expect(json).not.toContain("slow burn romance") // sinopse não vaza
    expect(json).not.toContain("isekai") // tag não vaza
  })
})
