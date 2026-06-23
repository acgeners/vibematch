import { describe, it, expect, vi } from "vitest"
import {
  classifyGoldenDigestItem,
  planGoldenDigestBatch,
  runGoldenDigestBatch,
  type GoldenDigestPlanInput,
  type GoldenDigestVersions,
  type SnapshotWorkRef,
  type CurrentWorkState,
  type DigestOutcome,
} from "@/lib/synopsis-interest/golden-digest"
import { CANDIDATES, computeCandidateInputSignature, type WorkSnapshotInput } from "@/lib/synopsis-interest/experiment"

const VERSIONS: GoldenDigestVersions = {
  experimentVersion: "digest-exp-1", goldenVersion: "pilot-1", snapshotVersion: "base-1",
  digestVersion: "digest-v1", promptVersion: "digest-v1", model: "claude-sonnet-4-6",
  schemaVersion: "v1", pricingVersion: "static@x", costPolicyVersion: "safety-1.5",
  corpusPolicyVersion: "text-only-v1",
}
const COST = (scale: number) => ({ likelyUsd: 0.04 + scale * 0.001, upperBoundUsd: (0.04 + scale * 0.001) * 1.5 })

function snap(workId: string, over: Partial<SnapshotWorkRef> = {}): SnapshotWorkRef {
  return { workId, reviewState: "frozen_current", reviewCorpusSignature: `corpus:${workId}`, ...over }
}
function cur(workId: string, over: Partial<CurrentWorkState> = {}): CurrentWorkState {
  return { workId, currentCorpusSignature: `corpus:${workId}`, digestPresent: false, digestVersion: null, ...over }
}

describe("golden-digest — classifyGoldenDigestItem", () => {
  it("no_reviews (corpus inalterado) → no_reviews_available; corpus mudou → corpus_changed", () => {
    expect(classifyGoldenDigestItem(snap("a", { reviewState: "no_reviews", reviewCorpusSignature: "empty" }), cur("a", { currentCorpusSignature: "empty" }), { digestVersion: "digest-v1" })).toBe("no_reviews_available")
    expect(classifyGoldenDigestItem(snap("a", { reviewState: "no_reviews", reviewCorpusSignature: "empty" }), cur("a", { currentCorpusSignature: "NOW-HAS-REVIEWS" }), { digestVersion: "digest-v1" })).toBe("corpus_changed")
  })
  it("corpus mudou (frozen_current) → corpus_changed", () => {
    expect(classifyGoldenDigestItem(snap("a"), cur("a", { currentCorpusSignature: "changed" }), { digestVersion: "digest-v1" })).toBe("corpus_changed")
  })
  it("digest ausente → missing; versão antiga → stale; versão atual → fresh_reusable", () => {
    expect(classifyGoldenDigestItem(snap("a"), cur("a"), { digestVersion: "digest-v1" })).toBe("corpus_unchanged_digest_missing")
    expect(classifyGoldenDigestItem(snap("a"), cur("a", { digestPresent: true, digestVersion: "digest-v0" }), { digestVersion: "digest-v1" })).toBe("corpus_unchanged_digest_stale")
    expect(classifyGoldenDigestItem(snap("a"), cur("a", { digestPresent: true, digestVersion: "digest-v1" }), { digestVersion: "digest-v1" })).toBe("corpus_unchanged_digest_fresh_reusable")
  })
})

describe("golden-digest — planGoldenDigestBatch", () => {
  function plan(items: GoldenDigestPlanInput["items"], over: Partial<GoldenDigestPlanInput> = {}) {
    return planGoldenDigestBatch({ versions: VERSIONS, snapshotBaseSignature: "snap", reviewCorpusSignature: "corpus-global", items, costPerWork: COST, ...over })
  }
  const items: GoldenDigestPlanInput["items"] = [
    { snap: snap("w-missing"), current: cur("w-missing"), usefulCount: 5 },
    { snap: snap("w-fresh"), current: cur("w-fresh", { digestPresent: true, digestVersion: "digest-v1" }), usefulCount: 5 },
    { snap: snap("w-stale"), current: cur("w-stale", { digestPresent: true, digestVersion: "old" }), usefulCount: 5 },
    { snap: snap("w-noreviews", { reviewState: "no_reviews", reviewCorpusSignature: "empty" }), current: cur("w-noreviews", { currentCorpusSignature: "empty" }), usefulCount: 0 },
  ]

  it("exclui no_reviews e fresh_reusable; elege missing+stale", () => {
    const p = plan(items)
    expect(p.eligibleWorkIds).toEqual(["w-missing", "w-stale"])
    expect(p.reusableWorkIds).toEqual(["w-fresh"])
    expect(p.noReviewsWorkIds).toEqual(["w-noreviews"])
    expect(p.blocked).toBe(false)
  })
  it("corpus mudado BLOQUEIA o plano", () => {
    const p = plan([{ snap: snap("w1"), current: cur("w1", { currentCorpusSignature: "changed" }), usefulCount: 5 }])
    expect(p.blocked).toBe(true)
    expect(p.changedWorkIds).toEqual(["w1"])
  })
  it("teto agregado obrigatório", () => {
    expect(plan(items).requiresAggregateAuthorization).toBe(true)
  })
  it("planSignature order-independent nos itens", () => {
    expect(plan(items).planSignature).toBe(plan([...items].reverse()).planSignature)
  })
  it("mudança em um review hash (corpus por obra) muda a assinatura", () => {
    const a = plan(items).planSignature
    const items2 = items.map((it) => it.snap.workId === "w-missing" ? { ...it, snap: { ...it.snap, reviewCorpusSignature: "DIFF" }, current: { ...it.current, currentCorpusSignature: "DIFF" } } : it)
    expect(plan(items2).planSignature).not.toBe(a)
  })
  it("mudança de pricing version muda a assinatura", () => {
    const a = plan(items).planSignature
    const b = plan(items, { versions: { ...VERSIONS, pricingVersion: "static@OTHER" } }).planSignature
    expect(a).not.toBe(b)
  })
  it("B2.2N: mudança da POLÍTICA do corpus muda a planSignature (não reutiliza plano)", () => {
    const a = plan(items).planSignature
    const b = plan(items, { versions: { ...VERSIONS, corpusPolicyVersion: "text-only-v2" } }).planSignature
    expect(a).not.toBe(b)
  })
  it("custo soma só os elegíveis (likely/upper)", () => {
    const p = plan(items)
    // 2 elegíveis, scale 5 → likely 0.045 cada, upper ×1.5
    expect(p.likelyUsd).toBeCloseTo(0.09)
    expect(p.upperBoundUsd).toBeCloseTo(0.135)
  })
})

describe("golden-digest — runGoldenDigestBatch (IO injetável; não executa nada real)", () => {
  function basePlan(eligible: string[]) {
    return planGoldenDigestBatch({
      versions: VERSIONS, snapshotBaseSignature: "snap", reviewCorpusSignature: "corpus",
      items: eligible.map((id) => ({ snap: snap(id), current: cur(id), usefulCount: 5 })),
      costPerWork: COST,
    })
  }
  const ok = (): DigestOutcome => ({ status: "succeeded", ranLlm: true, costUsd: 0.03 })
  const okDeps = (over: Record<string, unknown> = {}) => ({
    maxCostUsd: 100,
    upperFor: () => 0.06,
    recheck: async () => ({ snapshotValid: true, corpusUnchanged: true }),
    ensureDigest: vi.fn(async () => ok()),
    ...over,
  })

  it("completed quando todos elegíveis succeeded; 1 chamada por obra (sem retry)", async () => {
    const plan = basePlan(["a", "b", "c"])
    const deps = okDeps()
    const r = await runGoldenDigestBatch(plan, deps as never)
    expect(r.status).toBe("completed")
    expect(r.succeeded).toBe(3)
    expect((deps.ensureDigest as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3) // 1×/obra, sem retry
  })
  it("falha isolada NÃO apaga sucessos; status completed_with_failures (≠ completed)", async () => {
    const plan = basePlan(["a", "b"])
    let n = 0
    const deps = okDeps({ ensureDigest: vi.fn(async () => (++n === 1 ? { status: "failed", ranLlm: false, costUsd: 0, error: "boom" } : ok())) })
    const r = await runGoldenDigestBatch(plan, deps as never)
    expect(r.failed).toBe(1)
    expect(r.succeeded).toBe(1)
    expect(r.status).toBe("completed_with_failures")
    expect(r.status).not.toBe("completed")
  })
  it("soft-cap: custo real + upper da próxima > teto ⇒ stoppedByCost (parcial)", async () => {
    const plan = basePlan(["a", "b", "c"])
    const r = await runGoldenDigestBatch(plan, okDeps({ maxCostUsd: 0.05, upperFor: () => 0.06 }) as never)
    expect(r.stoppedByCost).toBe(true)
    expect(r.status).toBe("partial")
    expect(r.started).toBe(0) // 0 + 0.06 > 0.05 já na 1ª
  })
  it("SIGINT (shouldStop) impede novos itens", async () => {
    const plan = basePlan(["a", "b"])
    const r = await runGoldenDigestBatch(plan, okDeps({ shouldStop: () => true }) as never)
    expect(r.stoppedByCancel).toBe(true)
    expect(r.started).toBe(0)
  })
  it("plan_changed (corpus divergente no re-check) não inicia a obra", async () => {
    const plan = basePlan(["a", "b"])
    const r = await runGoldenDigestBatch(plan, okDeps({ recheck: async () => ({ snapshotValid: true, corpusUnchanged: false }) }) as never)
    expect(r.stoppedByPlanChange).toBe(true)
    expect(r.status).toBe("plan_changed")
  })
  it("plano blocked ⇒ não roda nada", async () => {
    const blocked = planGoldenDigestBatch({ versions: VERSIONS, snapshotBaseSignature: "s", reviewCorpusSignature: "c", items: [{ snap: snap("w"), current: cur("w", { currentCorpusSignature: "changed" }), usefulCount: 5 }], costPerWork: COST })
    const deps = okDeps()
    const r = await runGoldenDigestBatch(blocked, deps as never)
    expect(r.status).toBe("plan_changed")
    expect((deps.ensureDigest as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })
})

describe("golden-digest — candidatos b1/e1 (base × final)", () => {
  function work(over: Partial<WorkSnapshotInput> = {}): WorkSnapshotInput {
    return { workId: "w", titleSig: "t", synopsisSig: "s", tagsSig: "g", profileSig: "p", reviewContextType: "digest", reviewContextSig: "rc", ...over }
  }
  it("base de trabalho compartilhada: mudar título/sinopse/tags/perfil muda AMBOS b1 e e1", () => {
    const w = work()
    for (const f of ["titleSig", "synopsisSig", "tagsSig", "profileSig"] as const) {
      const w2 = work({ [f]: "OTHER" } as Partial<WorkSnapshotInput>)
      expect(computeCandidateInputSignature(CANDIDATES.b1, w2)).not.toBe(computeCandidateInputSignature(CANDIDATES.b1, w))
      expect(computeCandidateInputSignature(CANDIDATES.e1, w2)).not.toBe(computeCandidateInputSignature(CANDIDATES.e1, w))
    }
  })
  it("assinatura FINAL de b1 ≠ e1 (candidate id + review context distinguem)", () => {
    expect(computeCandidateInputSignature(CANDIDATES.b1, work())).not.toBe(computeCandidateInputSignature(CANDIDATES.e1, work()))
  })
  it("adicionar digest altera SÓ o enriquecido (e1), não b1", () => {
    const w = work()
    expect(computeCandidateInputSignature(CANDIDATES.e1, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.e1, work({ reviewContextSig: "DIGEST-ADDED" })))
    expect(computeCandidateInputSignature(CANDIDATES.b1, w)).toBe(computeCandidateInputSignature(CANDIDATES.b1, work({ reviewContextSig: "DIGEST-ADDED" })))
  })
  it("no_reviews gera contexto explícito e determinístico no e1", () => {
    const a = computeCandidateInputSignature(CANDIDATES.e1, work({ reviewContextType: "no_reviews", reviewContextSig: "no_reviews" }))
    const b = computeCandidateInputSignature(CANDIDATES.e1, work({ reviewContextType: "no_reviews", reviewContextSig: "no_reviews" }))
    expect(a).toBe(b)
  })
})
