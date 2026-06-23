import { describe, it, expect } from "vitest"
import {
  classifyDigestReadiness,
  reconcile,
  computePreflightReportSignature,
  FUTURE_GENERATION_CLASSES,
  type ExpectedDigestIdentity,
  type PreflightWorkInput,
  type DigestProvenance,
} from "@/lib/synopsis-interest/pilot2-preflight"

const EXP: ExpectedDigestIdentity = {
  corpusPolicyVersion: "text-only-v1",
  digestVersion: "digest-v1",
  promptVersion: "review-text-only-v1",
  model: "claude-sonnet-4-6",
  schema: "digest-schema-v1",
}

// digest com PROVA COMPLETA e equivalente (caso ideal — hoje inexistente no schema)
const fullProof = (over: Partial<DigestProvenance> = {}): DigestProvenance => ({
  present: true,
  version: "digest-v1",
  n: 5,
  corpusPolicyVersion: "text-only-v1",
  reviewCorpusSignature: "RC",
  digestSelectionSignature: "DS",
  promptVersion: "review-text-only-v1",
  model: "claude-sonnet-4-6",
  schema: "digest-schema-v1",
  ...over,
})

const work = (over: Partial<PreflightWorkInput> = {}): PreflightWorkInput => ({
  workId: "w1",
  reviewsAfterDedupe: 5,
  reviewCorpusSignature: "RC",
  digestSelectionSignature: "DS",
  persisted: null,
  ...over,
})

describe("preflight — classificação fail-closed", () => {
  it("no_reviews é excluído corretamente (0 textos)", () => {
    expect(classifyDigestReadiness(work({ reviewsAfterDedupe: 0, persisted: fullProof() }), EXP).readiness).toBe("no_reviews_available")
  })
  it("corpus útil sem digest persistido ⇒ digest_missing", () => {
    expect(classifyDigestReadiness(work({ persisted: null }), EXP).readiness).toBe("digest_missing")
  })
  it("digest existente SEM policy não é reutilizado (unproven)", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ corpusPolicyVersion: null }) }), EXP).readiness).toBe("digest_compatibility_unproven")
  })
  it("digest existente SEM prompt version não é reutilizado (unproven)", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ promptVersion: null }) }), EXP).readiness).toBe("digest_compatibility_unproven")
  })
  it("digest-v1 antigo (só version/n, sem proveniência) NÃO é suficiente ⇒ unproven", () => {
    const bare: DigestProvenance = { present: true, version: "digest-v1", n: 5 }
    expect(classifyDigestReadiness(work({ persisted: bare }), EXP).readiness).toBe("digest_compatibility_unproven")
  })
  it("política antiga (v0) com prova completa ⇒ digest_incompatible_corpus_policy", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ corpusPolicyVersion: "v0" }) }), EXP).readiness).toBe("digest_incompatible_corpus_policy")
  })
  it("prompt divergente (source-aware) ⇒ digest_incompatible_prompt", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ promptVersion: "source-aware-v0" }) }), EXP).readiness).toBe("digest_incompatible_prompt")
  })
  it("corpus signature divergente bloqueia reutilização ⇒ digest_corpus_changed", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ reviewCorpusSignature: "OUTRO" }) }), EXP).readiness).toBe("digest_corpus_changed")
  })
  it("selection signature divergente bloqueia reutilização ⇒ digest_selection_changed", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ digestSelectionSignature: "OUTRO" }) }), EXP).readiness).toBe("digest_selection_changed")
  })
  it("modelo divergente bloqueia reutilização (não reusable)", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ model: "claude-opus-4-7" }) }), EXP).readiness).not.toBe("digest_reusable_exact")
  })
  it("schema divergente bloqueia reutilização (não reusable)", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ schema: "outro" }) }), EXP).readiness).not.toBe("digest_reusable_exact")
  })
  it("digest malformado ⇒ blocked", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof({ malformed: true }) }), EXP).readiness).toBe("blocked")
  })
  it("work_id duplicado / ausente do snapshot ⇒ blocked", () => {
    expect(classifyDigestReadiness(work({ duplicateWorkId: true }), EXP).readiness).toBe("blocked")
    expect(classifyDigestReadiness(work({ missingFromSnapshot: true }), EXP).readiness).toBe("blocked")
  })
  it("PROVA COMPLETA e equivalente ⇒ digest_reusable_exact (único caminho de reutilização)", () => {
    expect(classifyDigestReadiness(work({ persisted: fullProof() }), EXP).readiness).toBe("digest_reusable_exact")
  })
})

describe("preflight — reconciliação", () => {
  // 19 no_reviews + 71 com reviews (todas missing) = 90
  const synth = [
    ...Array.from({ length: 19 }, (_, i) => classifyDigestReadiness(work({ workId: `nr${i}`, reviewsAfterDedupe: 0, persisted: fullProof() }), EXP)),
    ...Array.from({ length: 71 }, (_, i) => classifyDigestReadiness(work({ workId: `wr${i}`, reviewsAfterDedupe: 3, persisted: null }), EXP)),
  ]
  it("soma das classes = 90; 19 no_reviews; 71 com reviews", () => {
    const rc = reconcile(synth, { total: 90, noReviews: 19, withReviews: 71 })
    expect(rc.total).toBe(90)
    expect(rc.noReviews).toBe(19)
    expect(rc.withReviews).toBe(71)
    expect(rc.ok).toBe(true)
    expect(rc.violations).toEqual([])
  })
  it("futureGeneration + reusable = withReviews (71)", () => {
    const rc = reconcile(synth, { total: 90, noReviews: 19, withReviews: 71 })
    expect(rc.futureGeneration + rc.reusableExact).toBe(71)
    expect(FUTURE_GENERATION_CLASSES).not.toContain("digest_reusable_exact")
  })
  it("blocked > 0 ⇒ viola a reconciliação", () => {
    const withBlocked = [...synth.slice(0, 89), classifyDigestReadiness(work({ workId: "bad", duplicateWorkId: true }), EXP)]
    const rc = reconcile(withBlocked, { total: 90, noReviews: 19, withReviews: 71 })
    expect(rc.ok).toBe(false)
    expect(rc.violations.some((v) => v.includes("blocked"))).toBe(true)
  })
  it("contagem divergente ⇒ viola", () => {
    const rc = reconcile(synth.slice(0, 89), { total: 90, noReviews: 19, withReviews: 71 })
    expect(rc.ok).toBe(false)
  })
})

describe("preflight — assinatura diagnóstica (drift)", () => {
  const base = {
    base2Signature: "b2", base2r1Signature: "r1", reviewCorpusAggregateSignature: "rc",
    digestSelectionAggregateSignature: "ds", corpusPolicyVersion: "text-only-v1", expected: EXP,
    results: [classifyDigestReadiness(work({ workId: "a", persisted: null }), EXP)],
  }
  it("é determinística e order-independent nas obras", () => {
    const a = computePreflightReportSignature(base)
    const reordered = { ...base, results: [...base.results].reverse() }
    expect(computePreflightReportSignature(reordered)).toBe(a)
  })
  it("muda se uma assinatura de entrada (drift) mudar", () => {
    const a = computePreflightReportSignature(base)
    expect(computePreflightReportSignature({ ...base, base2r1Signature: "DRIFT" })).not.toBe(a)
  })
  it("muda se uma classificação mudar", () => {
    const a = computePreflightReportSignature(base)
    const changed = { ...base, results: [classifyDigestReadiness(work({ workId: "a", reviewsAfterDedupe: 0, persisted: fullProof() }), EXP)] }
    expect(computePreflightReportSignature(changed)).not.toBe(a)
  })
})
