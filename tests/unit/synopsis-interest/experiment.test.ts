import { describe, it, expect } from "vitest"
import {
  CANDIDATES,
  EXPERIMENT_DIGEST_VERSION,
  classifyGoldenDigest,
  computeCandidateInputSignature,
  computeSnapshotSignature,
  computeTagsSignature,
  resolveTagContext,
  planGoldenDigest,
  planCandidateDryRun,
  resolveReviewContext,
  isMaterialReviewGrowth,
  type GoldenDigestRow,
  type WorkSnapshotInput,
} from "@/lib/synopsis-interest/experiment"

function work(id: string, over: Partial<WorkSnapshotInput> = {}): WorkSnapshotInput {
  return {
    workId: id,
    titleSig: `t:${id}`,
    synopsisSig: `s:${id}`,
    tagsSig: `g:${id}`,
    profileSig: "profile:v7",
    reviewContextType: "no_reviews",
    reviewContextSig: "no_reviews",
    ...over,
  }
}

const COST = () => ({ likelyUsd: 0.01, upperBoundUsd: 0.015 })

describe("experiment — snapshot signature", () => {
  it("mesma snapshot → mesma assinatura", () => {
    const a = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("a"), work("b")], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    const b = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("a"), work("b")], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    expect(a).toBe(b)
  })

  it("ordem das obras NÃO altera a assinatura", () => {
    const a = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("a"), work("b"), work("c")], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    const b = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("c"), work("a"), work("b")], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    expect(a).toBe(b)
  })

  it("mudança de obra muda a assinatura", () => {
    const a = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("a")], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    const b = computeSnapshotSignature({ goldenVersion: "pilot-1", works: [work("a", { synopsisSig: "changed" })], promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    expect(a).not.toBe(b)
  })
})

describe("experiment — candidate input signature", () => {
  const w = work("x", { reviewContextType: "digest", reviewContextSig: "digest:fresh" })

  it("baseline NÃO depende de digest/summary", () => {
    const noCtx = computeCandidateInputSignature(CANDIDATES.b1, work("x"))
    const withDigest = computeCandidateInputSignature(CANDIDATES.b1, w)
    expect(noCtx).toBe(withDigest) // baseline ignora reviewContext
  })

  it("digest muda o candidato enriquecido", () => {
    const withDigest = computeCandidateInputSignature(CANDIDATES.e1, w)
    const withSummary = computeCandidateInputSignature(CANDIDATES.e1, work("x", { reviewContextType: "summary", reviewContextSig: "summary:fresh" }))
    expect(withDigest).not.toBe(withSummary)
  })

  it("summary muda o fallback do enriquecido", () => {
    const s1 = computeCandidateInputSignature(CANDIDATES.e1, work("x", { reviewContextType: "summary", reviewContextSig: "summary:hashA" }))
    const s2 = computeCandidateInputSignature(CANDIDATES.e1, work("x", { reviewContextType: "summary", reviewContextSig: "summary:hashB" }))
    expect(s1).not.toBe(s2)
  })

  it("sinopse/tags/perfil mudam ambos os candidatos", () => {
    for (const c of [CANDIDATES.b1, CANDIDATES.e1]) {
      const base = computeCandidateInputSignature(c, work("x"))
      expect(computeCandidateInputSignature(c, work("x", { synopsisSig: "z" }))).not.toBe(base)
      expect(computeCandidateInputSignature(c, work("x", { tagsSig: "z" }))).not.toBe(base)
      expect(computeCandidateInputSignature(c, work("x", { profileSig: "z" }))).not.toBe(base)
    }
  })

  it("baseline e enriquecido têm assinaturas distintas", () => {
    expect(computeCandidateInputSignature(CANDIDATES.b1, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.e1, w))
  })
})

describe("experiment — resolveReviewContext (fallback explícito)", () => {
  it("sem reviews úteis → no_reviews (estado legítimo)", () => {
    expect(resolveReviewContext({ usefulReviewCount: 0, digestPresent: false, digestFresh: false, summaryPresent: false, summaryFresh: false }).type).toBe("no_reviews")
  })
  it("digest fresco → digest", () => {
    expect(resolveReviewContext({ usefulReviewCount: 5, digestPresent: true, digestFresh: true, summaryPresent: true, summaryFresh: true }).type).toBe("digest")
  })
  it("sem digest, summary fresco → summary", () => {
    expect(resolveReviewContext({ usefulReviewCount: 5, digestPresent: false, digestFresh: false, summaryPresent: true, summaryFresh: true }).type).toBe("summary")
  })
  it("digest stale → estado explícito (sem substituição silenciosa)", () => {
    expect(resolveReviewContext({ usefulReviewCount: 5, digestPresent: true, digestFresh: false, summaryPresent: true, summaryFresh: true }).type).toBe("stale_digest")
  })
  it("summary stale → estado explícito", () => {
    expect(resolveReviewContext({ usefulReviewCount: 5, digestPresent: false, digestFresh: false, summaryPresent: true, summaryFresh: false }).type).toBe("stale_summary")
  })
  it("reviews sem artefato → missing", () => {
    expect(resolveReviewContext({ usefulReviewCount: 5, digestPresent: false, digestFresh: false, summaryPresent: false, summaryFresh: false }).type).toBe("missing")
  })
})

describe("experiment — tag context (4 estados; proveniência S078)", () => {
  it("lista não-vazia → tags_present", () => {
    expect(resolveTagContext(["romance"]).type).toBe("tags_present")
  })
  it("tags=[] sem recoverable → no_tags_legitimate (estável)", () => {
    expect(resolveTagContext([]).type).toBe("no_tags_legitimate")
    expect(computeTagsSignature([])).toBe(computeTagsSignature([]))
  })
  it("tags=[] recoverable → missing_recoverable_frozen_empty (S078)", () => {
    expect(resolveTagContext([], { recoverable: true }).type).toBe("missing_recoverable_frozen_empty")
    expect(computeTagsSignature([], { recoverable: true })).toBe(computeTagsSignature([], { recoverable: true }))
  })
  it("S078 (recuperável) tem assinatura DISTINTA de no_tags legítimo", () => {
    expect(computeTagsSignature([], { recoverable: true })).not.toBe(computeTagsSignature([]))
  })
  it("no_tags (ambos) ≠ lista de tags", () => {
    expect(computeTagsSignature([])).not.toBe(computeTagsSignature(["romance"]))
    expect(computeTagsSignature([], { recoverable: true })).not.toBe(computeTagsSignature(["romance"]))
  })
  it("loading_error (null/undefined) LANÇA — nunca assina", () => {
    expect(() => computeTagsSignature(null)).toThrow(/loading_error/)
    expect(() => computeTagsSignature(undefined)).toThrow(/loading_error/)
    expect(() => resolveTagContext(null)).toThrow()
  })
  it("ordem das tags NÃO afeta a assinatura", () => {
    expect(computeTagsSignature(["a", "b", "c"])).toBe(computeTagsSignature(["c", "a", "b"]))
  })
  it("normaliza (trim/lowercase) sem inventar tags", () => {
    expect(computeTagsSignature([" Romance ", "romance"])).toBe(computeTagsSignature(["romance", "romance"]))
    expect(resolveTagContext(["  ", "x"]).tags).toEqual(["x"]) // vazios filtrados, nada inventado
  })
})

describe("experiment — classifyGoldenDigest + isMaterialReviewGrowth", () => {
  it("no_reviews quando 0 úteis", () => {
    expect(classifyGoldenDigest({ workId: "a", usefulReviewCount: 0, digestPresent: false, digestVersion: null, digestN: null, summaryPresent: false })).toBe("no_reviews")
  })
  it("missing_with_reviews quando há reviews e sem digest", () => {
    expect(classifyGoldenDigest({ workId: "a", usefulReviewCount: 3, digestPresent: false, digestVersion: null, digestN: null, summaryPresent: true })).toBe("missing_with_reviews")
  })
  it("fresh quando versão atual e sem crescimento material", () => {
    expect(classifyGoldenDigest({ workId: "a", usefulReviewCount: 5, digestPresent: true, digestVersion: EXPERIMENT_DIGEST_VERSION, digestN: 5, summaryPresent: true })).toBe("fresh")
  })
  it("stale por versão antiga", () => {
    expect(classifyGoldenDigest({ workId: "a", usefulReviewCount: 5, digestPresent: true, digestVersion: "digest-v0", digestN: 5, summaryPresent: true })).toBe("stale")
  })
  it("stale por crescimento material", () => {
    expect(classifyGoldenDigest({ workId: "a", usefulReviewCount: 20, digestPresent: true, digestVersion: EXPERIMENT_DIGEST_VERSION, digestN: 5, summaryPresent: true })).toBe("stale")
  })
  it("isMaterialReviewGrowth: prev null → true; +2 → true; +1 → false", () => {
    expect(isMaterialReviewGrowth(null, 1)).toBe(true)
    expect(isMaterialReviewGrowth(5, 7)).toBe(true)
    expect(isMaterialReviewGrowth(5, 6)).toBe(false)
  })
})

describe("experiment — planGoldenDigest (puro, dry-run)", () => {
  const rows: GoldenDigestRow[] = [
    { workId: "w1", usefulReviewCount: 0, digestPresent: false, digestVersion: null, digestN: null, summaryPresent: false }, // no_reviews
    { workId: "w2", usefulReviewCount: 4, digestPresent: false, digestVersion: null, digestN: null, summaryPresent: true },  // missing+summary
    { workId: "w3", usefulReviewCount: 10, digestPresent: true, digestVersion: EXPERIMENT_DIGEST_VERSION, digestN: 10, summaryPresent: true }, // fresh
    { workId: "w4", usefulReviewCount: 10, digestPresent: true, digestVersion: "digest-v0", digestN: 10, summaryPresent: true }, // stale
  ]
  const allowed = ["w1", "w2", "w3", "w4"]

  it("conta corretamente e elege missing+stale", () => {
    const p = planGoldenDigest(rows, { goldenVersion: "pilot-1", allowedWorkIds: allowed, costPerWork: COST })
    expect(p.total).toBe(4)
    expect(p.noReviews).toBe(1)
    expect(p.fresh).toBe(1)
    expect(p.missingWithReviews).toBe(1)
    expect(p.summaryOnly).toBe(1)
    expect(p.stale).toBe(1)
    expect(p.eligibleWorkIds).toEqual(["w2", "w4"])
  })

  it("teto agregado SEMPRE obrigatório", () => {
    const p = planGoldenDigest(rows, { goldenVersion: "pilot-1", allowedWorkIds: allowed, costPerWork: COST })
    expect(p.requiresAggregateAuthorization).toBe(true)
    expect(p.upperBoundUsd).toBeCloseTo(0.03) // 2 elegíveis × 0.015
  })

  it("ID fora do golden BLOQUEIA (throw)", () => {
    expect(() => planGoldenDigest(rows, { goldenVersion: "pilot-1", allowedWorkIds: ["w1"], costPerWork: COST })).toThrow(/fora do escopo/)
  })

  it("planSignature é estável e order-independent", () => {
    const a = planGoldenDigest(rows, { goldenVersion: "pilot-1", allowedWorkIds: allowed, costPerWork: COST })
    const b = planGoldenDigest([...rows].reverse(), { goldenVersion: "pilot-1", allowedWorkIds: allowed, costPerWork: COST })
    expect(a.planSignature).toBe(b.planSignature)
  })
})

describe("experiment — planners operam SEM labels (0/90)", () => {
  const rows: GoldenDigestRow[] = [
    { workId: "w1", usefulReviewCount: 4, digestPresent: false, digestVersion: null, digestN: null, summaryPresent: true },
  ]
  it("planGoldenDigest produz plano com 0 labels disponíveis", () => {
    const p = planGoldenDigest(rows, { goldenVersion: "pilot-1", allowedWorkIds: ["w1"], costPerWork: () => ({ likelyUsd: 0.02, upperBoundUsd: 0.03 }) })
    expect(p.eligibleWorkIds).toEqual(["w1"])
    expect(typeof p.planSignature).toBe("string")
  })
  it("planCandidateDryRun não referencia labels", () => {
    const works = [work("a", { reviewContextType: "no_reviews", reviewContextSig: "no_reviews" })]
    const snap = computeSnapshotSignature({ goldenVersion: "pilot-1", works, promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })
    const dr = planCandidateDryRun(CANDIDATES.b1, works, { snapshotSignature: snap, costPerCall: () => ({ likelyUsd: 0.01, upperBoundUsd: 0.02 }) })
    expect(dr.callsNeeded).toBe(1)
  })
})

describe("experiment — planCandidateDryRun (não cria jobs/outputs)", () => {
  const works = [
    work("a", { reviewContextType: "digest", reviewContextSig: "digest:fresh" }),
    work("b", { reviewContextType: "summary", reviewContextSig: "summary:fresh" }),
    work("c", { reviewContextType: "no_reviews", reviewContextSig: "no_reviews" }),
  ]
  const snap = computeSnapshotSignature({ goldenVersion: "pilot-1", works, promptVersions: ["v2"], models: ["m"], schemaVersions: ["v1"] })

  it("conta por contexto e estima custo (todas as obras = sem reuso de produção)", () => {
    const dr = planCandidateDryRun(CANDIDATES.e1, works, { snapshotSignature: snap, costPerCall: COST })
    expect(dr.callsNeeded).toBe(3)
    expect(dr.byReviewContext.digest).toBe(1)
    expect(dr.byReviewContext.summary).toBe(1)
    expect(dr.byReviewContext.no_reviews).toBe(1)
    expect(dr.upperBoundUsd).toBeCloseTo(0.045)
  })

  it("baseline e enriquecido geram planSignatures distintas no mesmo snapshot", () => {
    const b = planCandidateDryRun(CANDIDATES.b1, works, { snapshotSignature: snap, costPerCall: COST })
    const e = planCandidateDryRun(CANDIDATES.e1, works, { snapshotSignature: snap, costPerCall: COST })
    expect(b.planSignature).not.toBe(e.planSignature)
    expect(b.snapshotSignature).toBe(e.snapshotSignature) // mesmo snapshot base
  })
})
