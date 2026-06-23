import { describe, it, expect } from "vitest"
import { buildPlan } from "@/lib/orchestration/planner"
import { emptyReadinessSnapshot, type WorkReadinessSnapshot } from "@/lib/orchestration/readiness"

function snap(overrides: Partial<WorkReadinessSnapshot> = {}): WorkReadinessSnapshot {
  return { ...emptyReadinessSnapshot(), ...overrides }
}

const READY_INTEREST = (): WorkReadinessSnapshot =>
  snap({
    tasteProfile: { present: true, isStub: false, stale: false },
    canonical: { present: true, stale: false },
    rawSynopsisCount: 1,
    tagsCount: 3,
    tagsUnenrichedCount: 0,
    ratedWorksCount: 50,
  })

describe("buildPlan — predict_interest_potential", () => {
  it("tudo pronto ⇒ sem passos, sem bloqueio, completo", () => {
    const plan = buildPlan("predict_interest_potential", READY_INTEREST())
    expect(plan.steps).toEqual([])
    expect(plan.blockedManual).toEqual([])
    expect(plan.usedFallbacks).toEqual([])
    expect(plan.partial).toBe(false)
  })

  it("sem perfil + obras suficientes ⇒ planeja ensure_taste_profile", () => {
    const plan = buildPlan(
      "predict_interest_potential",
      snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
    )
    expect(plan.steps.map((s) => s.action)).toEqual(["ensure_taste_profile"])
    expect(plan.blockedManual).toEqual([])
  })

  it("sem perfil + <10 obras ⇒ blocked_manual (pré-condição), sem passos", () => {
    const plan = buildPlan(
      "predict_interest_potential",
      snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, ratedWorksCount: 5 }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.blockedManual.length).toBe(1)
    expect(plan.blockedManual[0].producer).toBe("ensure_taste_profile")
  })

  it("perfil ok mas sem canonical (só bruta) ⇒ fallback parcial, sem bloqueio", () => {
    const plan = buildPlan(
      "predict_interest_potential",
      snap({ tasteProfile: { present: true, isStub: false, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
    )
    expect(plan.blockedManual).toEqual([])
    expect(plan.usedFallbacks).toContain("canonical_synopsis")
    expect(plan.partial).toBe(true)
    expect(plan.steps).toEqual([])
  })

  it("sem nenhuma sinopse ⇒ blocked_manual (pré-condição da própria ação)", () => {
    const plan = buildPlan(
      "predict_interest_potential",
      snap({ tasteProfile: { present: true, isStub: false, stale: false }, rawSynopsisCount: 0, ratedWorksCount: 50 }),
    )
    expect(plan.blockedManual.length).toBe(1)
    expect(plan.blockedManual[0].instruction.toLowerCase()).toContain("sinopse")
  })
})

describe("buildPlan — reviews/digest", () => {
  it("digest sem reviews e sem IDs aceitos ⇒ blocked_manual (IDs), sem passos", () => {
    const plan = buildPlan("generate_review_digest", snap({ reviewsCount: 0, externalIdsAcceptedCount: 0 }))
    expect(plan.steps).toEqual([])
    expect(plan.blockedManual.map((b) => b.dataKey)).toContain("external_ids_accepted")
  })

  it("digest sem reviews mas com IDs aceitos ⇒ planeja acquire_reviews", () => {
    const plan = buildPlan("generate_review_digest", snap({ reviewsCount: 0, externalIdsAcceptedCount: 1 }))
    expect(plan.steps.map((s) => s.action)).toEqual(["acquire_reviews"])
    expect(plan.blockedManual).toEqual([])
  })

  it("digest com reviews ⇒ sem passos nem bloqueio (roda a própria ação)", () => {
    const plan = buildPlan("generate_review_digest", snap({ reviewsCount: 5 }))
    expect(plan.steps).toEqual([])
    expect(plan.blockedManual).toEqual([])
  })
})

describe("buildPlan — recalculate_scores", () => {
  it("sem scores IA e sem perfil ⇒ fallback parcial, nada bloqueia", () => {
    const plan = buildPlan("recalculate_scores", snap({ categoryScoresAiCount: 0 }))
    expect(plan.blockedManual).toEqual([])
    expect(plan.steps).toEqual([])
    expect(plan.usedFallbacks).toEqual(expect.arrayContaining(["category_scores_ai", "taste_profile"]))
    expect(plan.partial).toBe(true)
  })
})
