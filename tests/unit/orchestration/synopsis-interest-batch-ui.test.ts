import { describe, it, expect, afterEach } from "vitest"
import {
  runInterestBatch,
  planInterestBatch,
  computeInterestInputSignature,
  SYNOPSIS_INTEREST_SCHEMA_VERSION,
  type InterestGateway,
  type InterestWorkData,
  type StoredPrediction,
  type SynopsisSource,
  type DefaultPredictFn,
} from "@/lib/orchestration/integrations/synopsis-interest"
import { mapInterestOutcome } from "@/lib/orchestration/integrations/interest-ui"
import type { EnsureTasteProfileOutcome } from "@/lib/orchestration/integrations/taste-profile"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

const EMPTY: TasteProfilePayload = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const ROW: TasteProfileRow = { id: "p", version: 6, is_current: true, is_stub: false, n_works_used: 12, input_hash: "h", model_name: MODEL, prompt_version: "v1", profile: EMPTY, raw_response: null, created_at: new Date().toISOString() }
const work = (i: number): InterestWorkData => ({ title: `T${i}`, tags: ["a", "b"], canonicalSynopsis: `sinopse canonica numero ${i} longa o suficiente para o prompt`, rawSynopsis: null })

function sigFor(id: string, w: InterestWorkData, source: SynopsisSource): string {
  return computeInterestInputSignature({
    workId: id,
    profileSignature: computeProfileSignature(ROW.profile),
    title: w.title,
    synopsis: (source === "canonical" ? w.canonicalSynopsis : w.rawSynopsis) ?? "",
    synopsisSource: source,
    tags: w.tags,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
  })
}

class BatchGateway implements InterestGateway {
  works = new Map<string, InterestWorkData>()
  stored = new Map<string, StoredPrediction | null>()
  async loadWork(id: string) {
    return this.works.get(id) ?? null
  }
  async loadCurrentPrediction(id: string) {
    return this.stored.get(id) ?? null
  }
  async consolidationJobStatus() {
    return null
  }
  async persistPrediction(args: Parameters<InterestGateway["persistPrediction"]>[0]) {
    this.stored.set(args.workId, { predictedQuality: args.predictedQuality, inputSignature: args.inputSignature, tasteProfileHash: computeProfileSignature(args.profile.profile), stale: false })
  }
}

const profileFresh = async (): Promise<EnsureTasteProfileOutcome> => ({ status: "fresh", profile: ROW })
function fakePredict(state: { calls: number }): DefaultPredictFn {
  return async () => {
    state.calls++
    return { predictedQuality: "♥♥♥", justification: "j", confidence: 0.6, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 }
  }
}

// ---- mapInterestOutcome (estados tipados p/ a UI) --------------------------

describe("mapInterestOutcome — estados tipados", () => {
  it("32) mapeia cada outcome para o estado da UI", () => {
    expect(mapInterestOutcome({ status: "fresh", predictedQuality: "♥♥", partial: false, usedFallbacks: [] }).status).toBe("fresh")
    expect(mapInterestOutcome({ status: "succeeded", predictedQuality: "♥♥♥", ranLlm: true, costUsd: 0.01, partial: true, usedFallbacks: ["raw_synopsis"] })).toMatchObject({ status: "succeeded", partial: true })
    expect(mapInterestOutcome({ status: "processing", reason: "consolidating" }).status).toBe("processing")
    expect(mapInterestOutcome({ status: "stale", reason: "input_changed" }).status).toBe("processing")
    expect(mapInterestOutcome({ status: "not_ready", reason: "no_synopsis", message: "x" }).status).toBe("not_ready")
    expect(mapInterestOutcome({ status: "blocked_manual", reason: "insufficient_works", message: "x" }).status).toBe("blocked_manual")
    const cost = mapInterestOutcome({ status: "blocked_cost_confirmation", reason: "profile_cascade", estimatedUsd: 0.6, likelyUsd: 0.4 })
    expect(cost.status).toBe("blocked_cost_confirmation")
    if (cost.status === "blocked_cost_confirmation") {
      expect(cost.upperBoundUsd).toBe(0.6)
      expect(cost.likelyUsd).toBe(0.4)
      expect(cost.message).toContain("0.4")
    }
    expect(mapInterestOutcome({ status: "failed", error: "boom" }).status).toBe("failed")
  })
})

// ---- planInterestBatch + runInterestBatch ----------------------------------

describe("lote (dry-run + execução com mocks)", () => {
  it("25/26) dry-run conta fresh/stale/ausentes; fresh não entra no custo", async () => {
    const gw = new BatchGateway()
    const ps = computeProfileSignature(ROW.profile)
    // 1 fresh (legado, hash bate), 2 ausentes
    gw.stored.set("w1", { predictedQuality: "♥♥♥", inputSignature: null, tasteProfileHash: ps, stale: false })
    gw.stored.set("w2", null)
    gw.stored.set("w3", null)
    const plan = await planInterestBatch(["w1", "w2", "w3"], { gateway: gw, profileSignature: ps, profileNeedsGeneration: false, profileScale: 12 })
    expect(plan.fresh).toBe(1)
    expect(plan.stale + plan.absent).toBe(2)
    // sem perfil a gerar: custo só das 2 previsões necessárias
    expect(plan.needsProfile).toBe(false)
    expect(plan.upperBoundUsd).toBeGreaterThan(0)
  })

  it("27/28) executa: pula fresh, soma custo das necessárias", async () => {
    const gw = new BatchGateway()
    for (const i of [1, 2, 3]) gw.works.set(`w${i}`, work(i))
    // w1 fresh (assinatura bate); w2/w3 ausentes
    gw.stored.set("w1", { predictedQuality: "♥♥", inputSignature: sigFor("w1", work(1), "canonical"), tasteProfileHash: computeProfileSignature(ROW.profile), stale: false })
    const st = { calls: 0 }
    const report = await runInterestBatch(["w1", "w2", "w3"], { gateway: gw, ensureProfile: profileFresh, predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(report.fresh).toBe(1)
    expect(report.succeeded).toBe(2)
    expect(st.calls).toBe(2)
    expect(report.costUsd).toBeCloseTo(0.02) // 2 × $0.01
  })

  it("30) soft cap: para de gastar ao acumular o teto (overshoot ≤ 1 item)", async () => {
    const gw = new BatchGateway()
    for (const i of [1, 2, 3, 4]) gw.works.set(`w${i}`, work(i))
    const st = { calls: 0 }
    // real $0.01/item; teto $0.015. w1 roda (acc 0.01<0.015); w2 roda (acc 0.02≥0.015);
    // w3/w4 bloqueiam. (A garantia dura — upper bound ≤ teto — é do dry-run no action.)
    const report = await runInterestBatch(["w1", "w2", "w3", "w4"], { gateway: gw, ensureProfile: profileFresh, predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1, maxCostUsd: 0.015 })
    expect(report.succeeded).toBe(2)
    expect(report.blocked).toBe(2)
    expect(st.calls).toBe(2)
  })

  it("relatório agrega failed e processing", async () => {
    const gw = new BatchGateway()
    gw.works.set("w1", work(1))
    gw.works.set("w2", work(2))
    const failing: DefaultPredictFn = async () => {
      throw new Error("boom")
    }
    const report = await runInterestBatch(["w1", "w2"], { gateway: gw, ensureProfile: profileFresh, predict: failing, jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(report.failed).toBe(2)
    expect(report.errors.length).toBe(2)
  })
})
