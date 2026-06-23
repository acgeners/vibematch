import { describe, it, expect } from "vitest"
import {
  resolveReadiness,
  emptyReadinessSnapshot,
  type WorkReadinessSnapshot,
} from "@/lib/orchestration/readiness"
import { ACTION_CONTRACTS, DATA_KEY_PRODUCER } from "@/lib/orchestration/contracts"

function snap(overrides: Partial<WorkReadinessSnapshot> = {}): WorkReadinessSnapshot {
  return { ...emptyReadinessSnapshot(), ...overrides }
}

describe("resolveReadiness", () => {
  it("snapshot vazio ⇒ tudo absent", () => {
    const r = resolveReadiness(emptyReadinessSnapshot())
    for (const v of Object.values(r)) expect(v).toBe("absent")
  })

  it("canonical present+fresh ⇒ fresh; present+stale ⇒ stale", () => {
    expect(resolveReadiness(snap({ canonical: { present: true, stale: false } })).canonical_synopsis).toBe("fresh")
    expect(resolveReadiness(snap({ canonical: { present: true, stale: true } })).canonical_synopsis).toBe("stale")
  })

  it("tags_enriched: parcial quando há tag sem grupo, fresh quando todas têm", () => {
    expect(resolveReadiness(snap({ tagsCount: 3, tagsUnenrichedCount: 1 })).tags_enriched).toBe("partial")
    expect(resolveReadiness(snap({ tagsCount: 3, tagsUnenrichedCount: 0 })).tags_enriched).toBe("fresh")
    expect(resolveReadiness(snap({ tagsCount: 0 })).tags_enriched).toBe("absent")
  })

  it("taste_profile: stub ⇒ partial; não-stub fresh/stale", () => {
    expect(resolveReadiness(snap({ tasteProfile: { present: true, isStub: true, stale: false } })).taste_profile).toBe("partial")
    expect(resolveReadiness(snap({ tasteProfile: { present: true, isStub: false, stale: false } })).taste_profile).toBe("fresh")
    expect(resolveReadiness(snap({ tasteProfile: { present: true, isStub: false, stale: true } })).taste_profile).toBe("stale")
  })

  it("category_scores_ai: 9⇒fresh, parcial⇒partial, 0⇒absent", () => {
    expect(resolveReadiness(snap({ categoryScoresAiCount: 9 })).category_scores_ai).toBe("fresh")
    expect(resolveReadiness(snap({ categoryScoresAiCount: 5 })).category_scores_ai).toBe("partial")
    expect(resolveReadiness(snap({ categoryScoresAiCount: 0 })).category_scores_ai).toBe("absent")
  })

  it("calculated_scores: recalc_pending ⇒ stale", () => {
    expect(resolveReadiness(snap({ scores: { present: true, stale: true } })).calculated_scores).toBe("stale")
  })
})

describe("registro de contratos (sanidade)", () => {
  it("a chave do registro bate com contract.action", () => {
    for (const [key, c] of Object.entries(ACTION_CONTRACTS)) expect(c.action).toBe(key)
  })

  it("DATA_KEY_PRODUCER: produtor não-nulo de fato produz aquele data key", () => {
    for (const [dataKey, producer] of Object.entries(DATA_KEY_PRODUCER)) {
      if (producer == null) continue
      expect(ACTION_CONTRACTS[producer].produces).toBe(dataKey)
    }
  })
})
