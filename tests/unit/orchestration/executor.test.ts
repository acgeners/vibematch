import { describe, it, expect, afterEach } from "vitest"
import { createOrchestrator, type ActionRunner } from "@/lib/orchestration/executor"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { emptyReadinessSnapshot, type WorkReadinessSnapshot } from "@/lib/orchestration/readiness"
import type { ActionName } from "@/lib/orchestration/contracts"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

function snap(overrides: Partial<WorkReadinessSnapshot> = {}): WorkReadinessSnapshot {
  return { ...emptyReadinessSnapshot(), ...overrides }
}

function recordingRunners(into: ActionName[], actions: ActionName[]) {
  const runners: Partial<Record<ActionName, ActionRunner>> = {}
  for (const a of actions) {
    runners[a] = async () => {
      into.push(a)
    }
  }
  return runners
}

const PROFILE_READY = { present: true, isStub: false, stale: false }

describe("ensureActionReady", () => {
  it("bloqueia (manual) sem gastar quando falta pré-requisito manual", async () => {
    const orch = createOrchestrator({ runners: {}, jobStore: new InMemoryJobStore() })
    const res = await orch.ensureActionReady({
      workId: "w1",
      action: "predict_interest_potential",
      snapshot: snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, ratedWorksCount: 5 }),
    })
    expect(res.status).toBe("blocked_manual")
  })

  it("exige confirmação quando a cascata é metered e não foi pré-autorizada", async () => {
    const orch = createOrchestrator({ runners: {}, jobStore: new InMemoryJobStore() })
    const res = await orch.ensureActionReady({
      workId: "w1",
      action: "predict_interest_potential",
      snapshot: snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
    })
    expect(res.status).toBe("blocked_cost_confirmation")
    if (res.status === "blocked_cost_confirmation") {
      expect(res.reason).toBe("threshold")
      expect(res.estimatedUsd).toBeGreaterThan(0)
    }
  })

  it("autorizado mas acima do teto ⇒ over_cap", async () => {
    const orch = createOrchestrator({ runners: {}, jobStore: new InMemoryJobStore() })
    const res = await orch.ensureActionReady({
      workId: "w1",
      action: "predict_interest_potential",
      snapshot: snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
      allowPaidDependencies: true,
      maxCostUsd: 0.05,
      // perfil sobre 200 obras ⇒ ~$0.21, acima do teto de $0.05
      scaleByAction: { ensure_taste_profile: 200 },
    })
    expect(res.status).toBe("blocked_cost_confirmation")
    if (res.status === "blocked_cost_confirmation") expect(res.reason).toBe("over_cap")
  })

  it("tudo pronto + custo micro ⇒ roda a ação e fica ready/complete", async () => {
    const ran: ActionName[] = []
    const orch = createOrchestrator({
      runners: recordingRunners(ran, ["predict_interest_potential"]),
      jobStore: new InMemoryJobStore(),
    })
    const res = await orch.ensureActionReady({
      workId: "w1",
      action: "predict_interest_potential",
      snapshot: snap({ tasteProfile: PROFILE_READY, canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
    })
    expect(res.status).toBe("ready")
    if (res.status === "ready") {
      expect(res.via).toBe("complete")
      expect(res.ranSteps).toContain("predict_interest_potential")
    }
    expect(ran).toEqual(["predict_interest_potential"])
  })

  it("entrada opcional ausente ⇒ ready/partial (fallback)", async () => {
    const ran: ActionName[] = []
    const orch = createOrchestrator({
      runners: recordingRunners(ran, ["predict_interest_potential"]),
      jobStore: new InMemoryJobStore(),
    })
    const res = await orch.ensureActionReady({
      workId: "w2",
      action: "predict_interest_potential",
      // perfil pronto, sem canonical (só bruta) ⇒ fallback parcial
      snapshot: snap({ tasteProfile: PROFILE_READY, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
    })
    expect(res.status).toBe("ready")
    if (res.status === "ready") {
      expect(res.via).toBe("partial")
      expect(res.usedFallbacks).toContain("canonical_synopsis")
    }
  })

  it("executa o pré-requisito automático ANTES da ação-alvo, na ordem", async () => {
    const ran: ActionName[] = []
    const orch = createOrchestrator({
      runners: recordingRunners(ran, ["ensure_taste_profile", "predict_interest_potential"]),
      jobStore: new InMemoryJobStore(),
    })
    const res = await orch.ensureActionReady({
      workId: "w3",
      action: "predict_interest_potential",
      snapshot: snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
      allowPaidDependencies: true,
    })
    expect(res.status).toBe("ready")
    expect(ran).toEqual(["ensure_taste_profile", "predict_interest_potential"])
  })

  it("falha clara quando um pré-requisito não tem runner registrado", async () => {
    const orch = createOrchestrator({ runners: {}, jobStore: new InMemoryJobStore() })
    const res = await orch.ensureActionReady({
      workId: "w4",
      action: "predict_interest_potential",
      snapshot: snap({ canonical: { present: true, stale: false }, rawSynopsisCount: 1, tagsCount: 2, ratedWorksCount: 50 }),
      allowPaidDependencies: true,
    })
    expect(res.status).toBe("failed")
    if (res.status === "failed") expect(res.failed).toContain("ensure_taste_profile")
  })
})
