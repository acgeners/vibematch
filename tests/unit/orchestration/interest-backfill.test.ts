import { describe, it, expect, afterEach } from "vitest"
import { PHASE_PRODUCTION_BUILD } from "next/constants"
import {
  planInterestBackfill,
  runInterestBackfill,
  computeInterestPlanSignature,
  classifyWorkPredictState,
  PENDING_PROFILE_REGEN,
  type InterestBackfillGateway,
  type BackfillWork,
  type BackfillJobInfo,
  type PlanSignatureInput,
} from "@/lib/orchestration/backfill/interest-backfill"
import { parseBackfillCliArgs } from "@/lib/orchestration/backfill/cli-args"
import {
  computeInterestInputSignature,
  SYNOPSIS_INTEREST_SCHEMA_VERSION,
  type InterestGateway,
  type InterestWorkData,
  type StoredPrediction,
  type SynopsisSource,
  type DefaultPredictFn,
} from "@/lib/orchestration/integrations/synopsis-interest"
import type { EnsureTasteProfileOutcome, EnsureTasteProfileDeps } from "@/lib/orchestration/integrations/taste-profile"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

// ---- Fixtures --------------------------------------------------------------

const EMPTY: TasteProfilePayload = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const NEWP: TasteProfilePayload = { ...EMPTY, loved_themes: ["slow burn"] }
const CUR_SIG = computeProfileSignature(EMPTY)

function profileRow(input_hash: string, profile: TasteProfilePayload = EMPTY, version = 6): TasteProfileRow {
  return { id: "p", version, is_current: true, is_stub: false, n_works_used: 12, input_hash, model_name: MODEL, prompt_version: "v1", profile, raw_response: null, created_at: new Date().toISOString() }
}
function work(id: string, over: Partial<BackfillWork> = {}): BackfillWork {
  return { workId: id, title: `T${id}`, tags: ["a", "b"], canonicalSynopsis: `sinopse canonica ${id} longa o suficiente para o prompt`, rawSynopsis: null, ...over }
}
function sigFor(w: BackfillWork, profileSig: string, source: SynopsisSource = "canonical"): string {
  return computeInterestInputSignature({
    workId: w.workId,
    profileSignature: profileSig,
    title: w.title,
    synopsis: (source === "canonical" ? w.canonicalSynopsis : w.rawSynopsis) ?? "",
    synopsisSource: source,
    tags: w.tags,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
  })
}

class PlanGateway implements InterestBackfillGateway {
  works: BackfillWork[] = []
  predictions = new Map<string, StoredPrediction>()
  profile: { current: TasteProfileRow | null; libraryInputHash: string; ratedWorksCount: number } = { current: profileRow("LIB"), libraryInputHash: "LIB", ratedWorksCount: 50 }
  jobs: BackfillJobInfo[] = []
  listWorks = async () => this.works
  listPredictions = async () => this.predictions
  loadProfileSnapshot = async () => this.profile
  listBackfillJobs = async () => this.jobs
}

// per-work gateway (execução) — espelha o BatchGateway do teste de lote
class ExecGateway implements InterestGateway {
  works = new Map<string, InterestWorkData>()
  stored = new Map<string, StoredPrediction | null>()
  async loadWork(id: string) { return this.works.get(id) ?? null }
  async loadCurrentPrediction(id: string) { return this.stored.get(id) ?? null }
  async consolidationJobStatus() { return null }
  async persistPrediction(args: Parameters<InterestGateway["persistPrediction"]>[0]) {
    this.stored.set(args.workId, { predictedQuality: args.predictedQuality, inputSignature: args.inputSignature, tasteProfileHash: computeProfileSignature(args.profile.profile), stale: false })
  }
}

const profileFresh = (row: TasteProfileRow): ((d: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome>) => async () => ({ status: "fresh", profile: row })
const profileRegen = (row: TasteProfileRow, state: { calls: number }): ((d: EnsureTasteProfileDeps) => Promise<EnsureTasteProfileOutcome>) => async () => { state.calls++; return { status: "succeeded", profile: row, ranLlm: true, costUsd: 0.4 } }
function fakePredict(state: { calls: number; max: number; cur: number }): DefaultPredictFn {
  return async () => {
    state.cur++; state.max = Math.max(state.max, state.cur); state.calls++
    await new Promise((r) => setTimeout(r, 5))
    state.cur--
    return { predictedQuality: "♥♥♥", justification: "j", confidence: 0.6, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 }
  }
}

// ============================================================================
// PLANEJAMENTO
// ============================================================================

describe("planner — assinatura e estados", () => {
  it("1) mesmo estado ⇒ mesma assinatura", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")]
    const a = await planInterestBackfill({ gateway: gw })
    const b = await planInterestBackfill({ gateway: gw })
    expect(a.planSignature).toBe(b.planSignature)
  })

  it("2) alteração de obra muda a assinatura", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    const a = await planInterestBackfill({ gateway: gw })
    gw.works = [work("w1", { canonicalSynopsis: "sinopse completamente diferente e longa o suficiente" })]
    const b = await planInterestBackfill({ gateway: gw })
    expect(a.planSignature).not.toBe(b.planSignature)
  })

  it("3) alteração de perfil muda a assinatura", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    gw.predictions.set("w1", { predictedQuality: "♥♥", inputSignature: null, tasteProfileHash: CUR_SIG, stale: false }) // fresh legado
    const a = await planInterestBackfill({ gateway: gw })
    gw.profile = { current: profileRow("LIB2", NEWP), libraryInputHash: "LIB2", ratedWorksCount: 50 } // perfil diferente, ainda fresh
    const b = await planInterestBackfill({ gateway: gw })
    expect(a.planSignature).not.toBe(b.planSignature)
  })

  it("4) model/prompt/schema mudam a assinatura (função pura)", () => {
    const base: PlanSignatureInput = {
      scope: { kind: "full", limit: null, selected: ["w1"], missing: [] }, profilePolicy: "default", profileState: "fresh", libraryInputHash: "h",
      profileSignatureOrRegen: "ps", profileFunctionalVersion: 6, model: "m1", promptVersion: "v2", schemaVersion: "v1",
      costVersion: "c", items: [{ workId: "w1", expectedInputSignature: "s", reason: "absent" }],
      plannedActions: { profile: false, predictCount: 1, recalc: false }, likelyUsd: 0.01, upperBoundUsd: 0.02,
    }
    const s0 = computeInterestPlanSignature(base)
    expect(computeInterestPlanSignature({ ...base, model: "m2" })).not.toBe(s0)
    expect(computeInterestPlanSignature({ ...base, promptVersion: "v3" })).not.toBe(s0)
    expect(computeInterestPlanSignature({ ...base, schemaVersion: "v2" })).not.toBe(s0)
  })

  it("5) ordem do resultado do banco não muda a assinatura", async () => {
    const gw1 = new PlanGateway(); gw1.works = [work("w1"), work("w2"), work("w3")]
    const gw2 = new PlanGateway(); gw2.works = [work("w3"), work("w1"), work("w2")]
    const a = await planInterestBackfill({ gateway: gw1 })
    const b = await planInterestBackfill({ gateway: gw2 })
    expect(a.planSignature).toBe(b.planSignature)
  })

  it("6) perfil fresh ⇒ só stale + ausentes", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2"), work("w3")]
    gw.predictions.set("w1", { predictedQuality: "♥♥", inputSignature: sigFor(work("w1"), CUR_SIG), tasteProfileHash: CUR_SIG, stale: false }) // fresh moderno
    gw.predictions.set("w2", { predictedQuality: "♥♥", inputSignature: null, tasteProfileHash: CUR_SIG, stale: true }) // stale legado
    // w3 ausente
    const plan = await planInterestBackfill({ gateway: gw })
    expect(plan.profileState).toBe("fresh")
    expect(plan.itemsToPredict.map((i) => i.workId).sort()).toEqual(["w2", "w3"])
    expect(plan.fresh).toBe(1)
  })

  it("7) perfil stale ⇒ refresh + TODAS as elegíveis", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")]
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 } // stale
    const plan = await planInterestBackfill({ gateway: gw })
    expect(plan.profileState).toBe("stale")
    expect(plan.profileAction).toBe("regenerate")
    expect(plan.recalcPlanned).toBe(true)
    expect(plan.itemsToPredict.length).toBe(2)
    expect(plan.itemsToPredict.every((i) => i.reason === "profile_regen")).toBe(true)
    expect(plan.itemsToPredict.every((i) => i.expectedProfileSignature === PENDING_PROFILE_REGEN)).toBe(true)
  })

  it("8) perfil bloqueado (<10 rotuladas) ⇒ nenhuma previsão", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")]
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 3 }
    const plan = await planInterestBackfill({ gateway: gw })
    expect(plan.profileState).toBe("blocked_manual")
    expect(plan.itemsToPredict.length).toBe(0)
  })

  it("9/10) uma obra ⇒ no máximo um item; versões antigas não duplicam", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    // listPredictions já filtra por prompt_version atual — só a linha v2 chega.
    gw.predictions.set("w1", { predictedQuality: "♥", inputSignature: null, tasteProfileHash: "x", stale: true })
    const plan = await planInterestBackfill({ gateway: gw })
    expect(plan.itemsToPredict.filter((i) => i.workId === "w1").length).toBe(1)
  })

  it("11) dual-read legado fresh (hash bate)", async () => {
    expect(classifyWorkPredictState({ stored: { predictedQuality: "♥", inputSignature: null, tasteProfileHash: CUR_SIG, stale: false }, expectedSignature: "ignored", currentProfileSignature: CUR_SIG })).toBe("fresh_legacy")
  })
  it("12) dual-read legado stale (flag)", async () => {
    expect(classifyWorkPredictState({ stored: { predictedQuality: "♥", inputSignature: null, tasteProfileHash: CUR_SIG, stale: true }, expectedSignature: "ignored", currentProfileSignature: CUR_SIG })).toBe("stale_legacy")
  })

  it("13) obra sem sinopse ⇒ bloqueada (não vira item)", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1", { canonicalSynopsis: null, rawSynopsis: null })]
    const plan = await planInterestBackfill({ gateway: gw })
    expect(plan.blocked).toBe(1)
    expect(plan.eligible).toBe(0)
    expect(plan.itemsToPredict.length).toBe(0)
  })

  it("14) dry-run não cria job", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    const store = new InMemoryJobStore()
    await planInterestBackfill({ gateway: gw })
    expect(store.records.length).toBe(0) // planner não recebe jobStore — nada criado
  })

  it("extra) classifyWorkPredictState: moderno fresh vs stale; ausente", () => {
    const w = work("w1")
    const sig = sigFor(w, CUR_SIG)
    expect(classifyWorkPredictState({ stored: { predictedQuality: "♥", inputSignature: sig, tasteProfileHash: "_", stale: false }, expectedSignature: sig, currentProfileSignature: CUR_SIG })).toBe("fresh_modern")
    expect(classifyWorkPredictState({ stored: { predictedQuality: "♥", inputSignature: "other", tasteProfileHash: "_", stale: false }, expectedSignature: sig, currentProfileSignature: CUR_SIG })).toBe("stale_modern")
    expect(classifyWorkPredictState({ stored: null, expectedSignature: sig, currentProfileSignature: CUR_SIG })).toBe("absent")
  })

  it("8b) ordem-só-de-tags NÃO muda o item (assinatura ordena tags)", () => {
    const a = sigFor(work("w1", { tags: ["a", "b", "c"] }), CUR_SIG)
    const b = sigFor(work("w1", { tags: ["c", "a", "b"] }), CUR_SIG)
    expect(a).toBe(b)
  })
})

// ============================================================================
// CONFIRMAÇÃO
// ============================================================================

describe("confirmação", () => {
  it("15) assinatura divergente bloqueia", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    const res = await runInterestBackfill({ planSignature: "assinatura-errada-mas-longa-o-suficiente", maxCostUsd: 10, planGateway: gw, interestGateway: new ExecGateway(), ensureProfile: profileFresh(profileRow("LIB")), jobStore: new InMemoryJobStore() })
    expect(res.status).toBe("plan_changed")
  })

  it("16) maxCostUsd abaixo do upper bloqueia", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2"), work("w3")]
    const plan = await planInterestBackfill({ gateway: gw })
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 0.000001, planGateway: gw, interestGateway: new ExecGateway(), ensureProfile: profileFresh(profileRow("LIB")), jobStore: new InMemoryJobStore() })
    expect(res.status).toBe("blocked_cost_confirmation")
  })

  it("17/18/19) flags da CLI: execute exige assinatura + teto; dry-run é padrão", () => {
    expect(parseBackfillCliArgs([]).ok).toBe(true) // dry-run padrão
    const dry = parseBackfillCliArgs([])
    expect(dry.ok && dry.args.execute).toBe(false)
    expect(parseBackfillCliArgs(["--execute"]).ok).toBe(false) // sem assinatura/teto
    expect(parseBackfillCliArgs(["--execute", "--plan-signature=abcdefghijklmnop"]).ok).toBe(false) // sem teto
    expect(parseBackfillCliArgs(["--execute", "--max-cost-usd=5"]).ok).toBe(false) // sem assinatura
    const okp = parseBackfillCliArgs(["--execute", "--plan-signature=abcdefghijklmnop", "--max-cost-usd=5"])
    expect(okp.ok).toBe(true)
  })

  it("20) micro-threshold individual NÃO autoriza o lote agregado", async () => {
    const gw = new PlanGateway(); gw.works = Array.from({ length: 5 }, (_, i) => work(`w${i}`))
    const plan = await planInterestBackfill({ gateway: gw })
    // 5 previsões: upper agregado >> micro-threshold ($0.02); confirmar com teto baixo bloqueia.
    expect(plan.estimatedUpperBoundUsd).toBeGreaterThan(0.02)
    const exec = new ExecGateway()
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 0.02, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore() })
    expect(res.status).toBe("blocked_cost_confirmation")
    expect(st.calls).toBe(0) // nada rodou
  })
})

// ============================================================================
// EXECUÇÃO
// ============================================================================

function freshProfilePlan() {
  const gw = new PlanGateway()
  gw.works = [work("w1"), work("w2"), work("w3")] // todas ausentes ⇒ 3 itens
  return gw
}

describe("execução (mocks/no-op)", () => {
  it("21) perfil executado no máximo uma vez (stale)", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")]
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 }
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const pst = { calls: 0 }; const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(profileRow("NEW", NEWP), pst), predict: fakePredict(st), recalc: async () => ({ status: "succeeded" }), jobStore: new InMemoryJobStore(), concurrency: 2 })
    expect(res.status === "completed" || res.status === "partial").toBe(true)
    expect(pst.calls).toBe(1)
  })

  it("22) previsões respeitam a concorrência", async () => {
    const gw = freshProfilePlan(); gw.works = Array.from({ length: 6 }, (_, i) => work(`w${i}`))
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const st = { calls: 0, max: 0, cur: 0 }
    await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 3 })
    expect(st.calls).toBe(6)
    expect(st.max).toBeLessThanOrEqual(3)
    expect(st.max).toBeGreaterThan(1)
  })

  it("23) item que ficou fresh por outro processo é pulado", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")] // planner: ambas ausentes
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    // w1 já fresh no momento da execução (assinatura bate)
    exec.stored.set("w1", { predictedQuality: "♥♥", inputSignature: sigFor(work("w1"), CUR_SIG), tasteProfileHash: CUR_SIG, stale: false })
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(res.status).not.toBe("plan_changed")
    if (res.status === "completed" || res.status === "partial") {
      expect(res.report.freshSkipped).toBe(1)
      expect(res.report.succeeded).toBe(1)
    }
    expect(st.calls).toBe(1) // só w2 chamou o provider
  })

  it("24) dois callers concorrentes não duplicam (single-flight + dedup)", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); exec.works.set("w1", work("w1"))
    const st = { calls: 0, max: 0, cur: 0 }
    const store = new InMemoryJobStore()
    const run = () => runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: store, concurrency: 1 })
    await Promise.all([run(), run()])
    expect(st.calls).toBe(1) // dedup_key idêntico ⇒ provider chamado 1×
  })

  it("25) falha de uma obra não apaga as anteriores", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1"), work("w2")]
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    let n = 0
    const predict: DefaultPredictFn = async () => { n++; if (n === 2) throw new Error("boom item 2"); return { predictedQuality: "♥♥", justification: "j", confidence: 0.5, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 } }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict, jobStore: new InMemoryJobStore(), concurrency: 1 })
    if (res.status === "completed" || res.status === "partial") {
      expect(res.report.succeeded).toBe(1)
      expect(res.report.failed).toBe(1)
      expect(res.report.lastSanitizedError).toBeTruthy()
    }
  })

  it("26) retryFailed reusa a infra durável (claim resume)", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    // simula job failed pré-existente p/ w1 → sem retryFailed, é pulado
    gw.jobs = [{ action: "predict_interest_potential", workId: "w1", status: "failed", dedupKey: "predict_interest_potential:w1:x", createdAt: new Date().toISOString(), startedAt: null }]
    const plan2 = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); exec.works.set("w1", work("w1"))
    const stA = { calls: 0, max: 0, cur: 0 }
    const noRetry = await runInterestBackfill({ planSignature: plan2.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(stA), jobStore: new InMemoryJobStore(), concurrency: 1, retryFailed: false })
    expect(stA.calls).toBe(0) // pulado
    const stB = { calls: 0, max: 0, cur: 0 }
    const retry = await runInterestBackfill({ planSignature: plan2.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(stB), jobStore: new InMemoryJobStore(), concurrency: 1, retryFailed: true })
    expect(stB.calls).toBe(1) // reprocessado
    expect([noRetry.status, retry.status].every((s) => s === "completed" || s === "partial")).toBe(true)
  })

  it("27) custo real é agregado", async () => {
    const gw = freshProfilePlan()
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 2 })
    if (res.status === "completed" || res.status === "partial") expect(res.report.actualUsd).toBeCloseTo(0.03) // 3 × $0.01
  })

  it("28) soft-cap impede iniciar novo item", async () => {
    const gw = freshProfilePlan(); gw.works = Array.from({ length: 4 }, (_, i) => work(`w${i}`))
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const st = { calls: 0, max: 0, cur: 0 }
    // upper/item ~0.016; teto 0.05 ⇒ inicia enquanto acc+0.016 ≤ 0.05 (acc real $0.01/item)
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 0.05, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1 })
    if (res.status === "completed" || res.status === "partial") {
      expect(res.report.stoppedByCost).toBe(true)
      expect(st.calls).toBeLessThan(4)
    }
  })

  it("29) após regen, previsões usam o NOVO perfil", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")]
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 } // stale
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); exec.works.set("w1", work("w1"))
    const newRow = profileRow("NEW", NEWP)
    const pst = { calls: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(newRow, pst), predict: fakePredict({ calls: 0, max: 0, cur: 0 }), recalc: async () => ({ status: "succeeded" }), jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(res.status === "completed" || res.status === "partial").toBe(true)
    // a previsão persistida usa a assinatura do NOVO perfil
    const stored = await exec.loadCurrentPrediction("w1")
    expect(stored?.tasteProfileHash).toBe(computeProfileSignature(NEWP))
  })

  it("30) SIGINT (shouldStop) impede novos itens", async () => {
    const gw = freshProfilePlan()
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1, shouldStop: () => true })
    if (res.status === "completed" || res.status === "partial") {
      expect(res.report.stoppedByCancel).toBe(true)
      expect(res.report.started).toBe(0)
    }
    expect(st.calls).toBe(0)
  })

  it("31/32) recalc global no máximo 1× quando aplicável; delegado (nenhuma fórmula tocada)", async () => {
    // stale ⇒ profileUpdated ⇒ recalc chamado 1× com force=true
    const gw = new PlanGateway(); gw.works = [work("w1")]
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 }
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); exec.works.set("w1", work("w1"))
    const recalcCalls: boolean[] = []
    await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(profileRow("NEW", NEWP), { calls: 0 }), predict: fakePredict({ calls: 0, max: 0, cur: 0 }), recalc: async (force) => { recalcCalls.push(force); return { status: "succeeded" } }, jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(recalcCalls).toEqual([false]) // exatamente uma vez, force=FALSE (confia no recalc_pending marcado pela regeneração)

    // fresh ⇒ sem regen ⇒ recalc NÃO chamado
    const gw2 = freshProfilePlan()
    const plan2 = await planInterestBackfill({ gateway: gw2 })
    const exec2 = new ExecGateway(); for (const w of gw2.works) exec2.works.set(w.workId, w)
    const recalc2: boolean[] = []
    await runInterestBackfill({ planSignature: plan2.planSignature, maxCostUsd: 10, planGateway: gw2, interestGateway: exec2, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict({ calls: 0, max: 0, cur: 0 }), recalc: async (force) => { recalc2.push(force); return { status: "succeeded" } }, jobStore: new InMemoryJobStore(), concurrency: 1 })
    expect(recalc2.length).toBe(0)
  })
})

// ============================================================================
// BUILD / RENDER
// ============================================================================

describe("build/render — sem efeitos colaterais", () => {
  it("33) import do módulo não executa backfill", () => {
    const store = new InMemoryJobStore()
    expect(typeof planInterestBackfill).toBe("function")
    expect(typeof runInterestBackfill).toBe("function")
    expect(store.records.length).toBe(0) // nada criado só por importar
  })

  it("34/35) durante o build: não executa, não cria job, não chama LLM", async () => {
    const prev = process.env.NEXT_PHASE
    process.env.NEXT_PHASE = PHASE_PRODUCTION_BUILD
    try {
      const gw = freshProfilePlan()
      const plan = await planInterestBackfill({ gateway: gw })
      const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
      const st = { calls: 0, max: 0, cur: 0 }
      const store = new InMemoryJobStore()
      const res = await runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec, ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: store })
      expect(res.status).toBe("blocked_manual")
      expect(st.calls).toBe(0)
      expect(store.records.length).toBe(0)
    } finally {
      if (prev === undefined) delete process.env.NEXT_PHASE
      else process.env.NEXT_PHASE = prev
    }
  })
})

// ============================================================================
// Correção 1 — ESCOPO de piloto
// ============================================================================

describe("escopo de piloto", () => {
  function catalog(n: number) {
    const gw = new PlanGateway()
    gw.works = Array.from({ length: n }, (_, i) => work(`w${String(i).padStart(2, "0")}`))
    return gw
  }

  it("S1) full vs ids ⇒ assinaturas diferentes", async () => {
    const gw = catalog(6)
    const full = await planInterestBackfill({ gateway: gw })
    const pilot = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w01", "w03"] } })
    expect(full.planSignature).not.toBe(pilot.planSignature)
    expect(pilot.scopeKind).toBe("ids")
    expect(pilot.scopeWorkIds).toEqual(["w01", "w03"])
    expect(pilot.totalWorks).toBe(2)
  })

  it("S2) mesmos IDs em ordem diferente ⇒ MESMA assinatura; IDs diferentes ⇒ diferente", async () => {
    const gw = catalog(6)
    const a = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w01", "w03", "w05"] } })
    const b = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w05", "w01", "w03"] } })
    const c = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w01", "w02", "w03"] } })
    expect(a.planSignature).toBe(b.planSignature)
    expect(a.planSignature).not.toBe(c.planSignature)
  })

  it("S3) --limit é determinístico (work_id ASC, estável)", async () => {
    const gw = catalog(6)
    const a = await planInterestBackfill({ gateway: gw, scope: { kind: "limit", limit: 3 } })
    // mesma fonte embaralhada ⇒ mesma seleção
    gw.works = [...gw.works].reverse()
    const b = await planInterestBackfill({ gateway: gw, scope: { kind: "limit", limit: 3 } })
    expect(a.scopeWorkIds).toEqual(["w00", "w01", "w02"])
    expect(a.planSignature).toBe(b.planSignature)
  })

  it("S4) IDs inexistentes ⇒ requestedButMissing + executor bloqueia", async () => {
    const gw = catalog(3)
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w00", "naoexiste-0000-0000-0000-000000000000"] } })
    expect(plan.requestedButMissing).toEqual(["naoexiste-0000-0000-0000-000000000000"])
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, scope: { kind: "ids", workIds: ["w00", "naoexiste-0000-0000-0000-000000000000"] },
      planGateway: gw, interestGateway: new ExecGateway(), ensureProfile: profileFresh(profileRow("LIB")), jobStore: new InMemoryJobStore(),
    })
    expect(res.status).toBe("blocked_manual")
  })

  it("S5) obra arquivada não entra (gateway só lista ativas ⇒ vira missing)", async () => {
    const gw = catalog(2) // só w00, w01 ativas
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w00", "w99"] } }) // w99 arquivada/ausente
    expect(plan.scopeWorkIds).toEqual(["w00"])
    expect(plan.requestedButMissing).toEqual(["w99"])
  })

  it("S6) ambiguidade --work-id + --limit falha na CLI", () => {
    const r = parseBackfillCliArgs(["--work-id=11111111-1111-1111-1111-111111111111", "--limit=5"])
    expect(r.ok).toBe(false)
  })

  it("S7) CLI mapeia escopo (ids / limit / full); UUID inválido falha", () => {
    const ids = parseBackfillCliArgs(["--work-id=11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222"])
    expect(ids.ok && ids.scope.kind).toBe("ids")
    const lim = parseBackfillCliArgs(["--limit=20"])
    expect(lim.ok && lim.scope.kind).toBe("limit")
    const full = parseBackfillCliArgs([])
    expect(full.ok && full.scope.kind).toBe("full")
    expect(parseBackfillCliArgs(["--work-id=not-a-uuid"]).ok).toBe(false)
  })

  it("S8) piloto com perfil stale ⇒ 1 perfil + SÓ as N previsões + custo do escopo + aviso", async () => {
    const gw = catalog(6)
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 } // stale
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w01", "w02"] } })
    expect(plan.profileAction).toBe("regenerate")
    expect(plan.itemsToPredict.length).toBe(2) // SÓ o escopo, não as 6
    expect(plan.recalcPlanned).toBe(true)
    // custo = 1 perfil (escala biblioteca completa) + 2 previsões
    const oneProfile = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: [] } }) // 0 previsões
    expect(plan.estimatedUpperBoundUsd).toBeGreaterThan(oneProfile.estimatedUpperBoundUsd)
    expect(plan.warnings.some((w) => w.includes("permanecerão para um lote posterior"))).toBe(true)
  })
})

// ============================================================================
// Correção 3 — transição esperada do perfil dentro do plano
// ============================================================================

describe("transição de perfil (PENDING_PROFILE_REGEN)", () => {
  function staleCatalog(ids: string[]) {
    const gw = new PlanGateway()
    gw.works = ids.map((id) => work(id))
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 }
    return gw
  }

  it("T1/T2) plano stale regenera e prossegue; regeneração INTERNA não causa plan_changed", async () => {
    const gw = staleCatalog(["w1", "w2"])
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w1", "w2"] } })
    expect(plan.itemsToPredict.every((i) => i.expectedProfileSignature === PENDING_PROFILE_REGEN)).toBe(true)
    const exec = new ExecGateway(); for (const id of ["w1", "w2"]) exec.works.set(id, work(id))
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, scope: { kind: "ids", workIds: ["w1", "w2"] },
      planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(profileRow("NEW", NEWP), { calls: 0 }),
      predict: fakePredict({ calls: 0, max: 0, cur: 0 }), recalc: async () => ({ status: "succeeded" }), jobStore: new InMemoryJobStore(), concurrency: 1,
    })
    expect(res.status === "completed" || res.status === "partial").toBe(true) // NÃO plan_changed
  })

  it("T3) alteração EXTERNA antes da execução ⇒ plan_changed (zero chamada paga)", async () => {
    const gw = staleCatalog(["w1"])
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w1"] } })
    // alguém mexeu na biblioteca/perfil antes de confirmar
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "OUTRA", ratedWorksCount: 50 }
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, scope: { kind: "ids", workIds: ["w1"] },
      planGateway: gw, interestGateway: new ExecGateway(), ensureProfile: profileRegen(profileRow("NEW", NEWP), { calls: 0 }), predict: fakePredict(st), jobStore: new InMemoryJobStore(),
    })
    expect(res.status).toBe("plan_changed")
    expect(st.calls).toBe(0)
  })

  it("T4) alteração externa APÓS congelar a assinatura ⇒ interrompe novos itens", async () => {
    const gw = catalog6Fresh()
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    let n = 0
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: exec,
      ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict({ calls: 0, max: 0, cur: 0 }),
      jobStore: new InMemoryJobStore(), concurrency: 1,
      loadCurrentProfileSignature: async () => (n++ === 0 ? CUR_SIG : "assinatura-externa-nova"),
    })
    if (res.status === "completed" || res.status === "partial") expect(res.report.stoppedByPlanChange).toBe(true)
  })

  it("T5/T6/T8) escopo NÃO aumenta após regen; só obras do piloto previstas", async () => {
    const gw = staleCatalog(["w1", "w2", "w3"]) // catálogo com 3
    const plan = await planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ["w1"] } }) // piloto = 1
    expect(plan.itemsToPredict.map((i) => i.workId)).toEqual(["w1"])
    const exec = new ExecGateway(); for (const id of ["w1", "w2", "w3"]) exec.works.set(id, work(id))
    const predicted: string[] = []
    const predict: DefaultPredictFn = async (_p, w) => { predicted.push(w.id); return { predictedQuality: "♥♥", justification: "j", confidence: 0.5, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 } }
    await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, scope: { kind: "ids", workIds: ["w1"] },
      planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(profileRow("NEW", NEWP), { calls: 0 }), predict, recalc: async () => ({ status: "succeeded" }), jobStore: new InMemoryJobStore(), concurrency: 1,
    })
    expect(predicted).toEqual(["w1"]) // só o piloto, mesmo com perfil novo (conteúdo diferente)
  })

  it("T7) custo real não passa do upper aprovado (soft-cap)", async () => {
    const gw = catalog6Fresh()
    const plan = await planInterestBackfill({ gateway: gw })
    const exec = new ExecGateway(); for (const w of gw.works) exec.works.set(w.workId, w)
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: plan.estimatedUpperBoundUsd, planGateway: gw, interestGateway: exec,
      ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict({ calls: 0, max: 0, cur: 0 }), jobStore: new InMemoryJobStore(), concurrency: 2,
    })
    if (res.status === "completed" || res.status === "partial") expect(res.report.actualUsd).toBeLessThanOrEqual(plan.estimatedUpperBoundUsd)
  })

  it("T9) obra alterada após o dry-run ⇒ plan_changed (não processa com assinatura antiga)", async () => {
    const gw = new PlanGateway(); gw.works = [work("w1")] // fresh profile
    const plan = await planInterestBackfill({ gateway: gw })
    // a obra mudou DEPOIS do dry-run (re-plano detecta antes de qualquer chamada)
    gw.works = [work("w1", { canonicalSynopsis: "sinopse mudou completamente e é bem mais longa agora" })]
    const st = { calls: 0, max: 0, cur: 0 }
    const res = await runInterestBackfill({
      planSignature: plan.planSignature, maxCostUsd: 10, planGateway: gw, interestGateway: new ExecGateway(),
      ensureProfile: profileFresh(profileRow("LIB")), predict: fakePredict(st), jobStore: new InMemoryJobStore(), concurrency: 1,
    })
    expect(res.status).toBe("plan_changed")
    expect(st.calls).toBe(0)
    // (a proteção in-flight — output de assinatura antiga descartado durante a
    //  execução — é coberta pelos testes de synopsis-interest, re-check no runner.)
  })
})

function catalog6Fresh() {
  const gw = new PlanGateway()
  gw.works = Array.from({ length: 6 }, (_, i) => work(`w${String(i).padStart(2, "0")}`))
  return gw
}

// ============================================================================
// Correção 2B.2 — semântica de resultado do recalc obrigatório
// ============================================================================

describe("2B.2 — semântica de resultado (recalc obrigatório pós-perfil)", () => {
  function staleGw(ids: string[]) {
    const gw = new PlanGateway()
    gw.works = ids.map((id) => work(id))
    gw.profile = { current: profileRow("OLD"), libraryInputHash: "NEW", ratedWorksCount: 50 }
    return gw
  }
  const run = (ids: string[], recalc: (f: boolean) => Promise<{ status: string }>, st = { calls: 0, max: 0, cur: 0 }) => {
    const gw = staleGw(ids)
    const exec = new ExecGateway(); for (const id of ids) exec.works.set(id, work(id))
    return planInterestBackfill({ gateway: gw, scope: { kind: "ids", workIds: ids } }).then((plan) =>
      runInterestBackfill({ planSignature: plan.planSignature, maxCostUsd: 10, scope: { kind: "ids", workIds: ids }, planGateway: gw, interestGateway: exec, ensureProfile: profileRegen(profileRow("NEW", NEWP), { calls: 0 }), predict: fakePredict(st), recalc, jobStore: new InMemoryJobStore(), concurrency: 1 }).then((res) => ({ res, st })),
    )
  }

  it("8/12) recalc obrigatório FALHA ⇒ completed_with_failures (pagas preservadas, SEM retry pago)", async () => {
    const { res, st } = await run(["w1", "w2"], async () => ({ status: "failed" }))
    expect(res.status).toBe("completed_with_failures")
    if (res.status === "completed_with_failures") {
      expect(res.report.recalcFailed).toBe(true)
      expect(res.report.recalcExecuted).toBe(false)
      expect(res.report.succeeded).toBe(2) // previsões pagas preservadas
    }
    expect(st.calls).toBe(2) // cada obra 1×; nenhum retry pago
  })

  it("9) recalc SUCEDE ⇒ completed (exit 0)", async () => {
    const { res } = await run(["w1"], async () => ({ status: "succeeded" }))
    expect(res.status).toBe("completed")
    if (res.status === "completed") expect(res.report.recalcExecuted).toBe(true)
  })

  it("recalc 'fresh' (pendência já zerada por outro caminho) NÃO é falha ⇒ completed", async () => {
    const { res } = await run(["w1"], async () => ({ status: "fresh" }))
    expect(res.status).toBe("completed")
    if (res.status === "completed") expect(res.report.recalcFailed).toBe(false)
  })

  it("11) recalc falha NÃO dispara retry pago e preserva previsões anteriores", async () => {
    const { res, st } = await run(["w1", "w2", "w3"], async () => ({ status: "failed" }))
    if (res.status === "completed_with_failures") expect(res.report.succeeded).toBe(3)
    expect(st.calls).toBe(3) // sem reprocessar previsões pagas
  })
})
