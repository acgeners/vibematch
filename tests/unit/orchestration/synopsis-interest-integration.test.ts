import { describe, it, expect, afterEach } from "vitest"
import {
  ensurePredictInterest,
  computeInterestInputSignature,
  classifyInterestReadiness,
  interestDedupKey,
  planInterestBatch,
  SYNOPSIS_INTEREST_SCHEMA_VERSION,
  type InterestGateway,
  type InterestWorkData,
  type StoredPrediction,
  type SynopsisSource,
  type EnsurePredictInterestDeps,
  type DefaultPredictFn,
} from "@/lib/orchestration/integrations/synopsis-interest"
import type { EnsureTasteProfileOutcome, EnsureTasteProfileDeps } from "@/lib/orchestration/integrations/taste-profile"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import type { SynopsisQuality } from "@/types/domain"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

const W = "work-1"
const EMPTY: TasteProfilePayload = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const LOVED: TasteProfilePayload = { ...EMPTY, loved_tags: [{ name: "ação", group: null, strength: 0.9 }] }

function profileRow(payload: TasteProfilePayload = EMPTY, over: Partial<TasteProfileRow> = {}): TasteProfileRow {
  return { id: "p", version: 6, is_current: true, is_stub: false, n_works_used: 12, input_hash: "h", model_name: MODEL, prompt_version: "v1", profile: payload, raw_response: null, created_at: new Date().toISOString(), ...over }
}

const canonWork: InterestWorkData = { title: "Titulo", tags: ["a", "b"], canonicalSynopsis: "uma sinopse canonica longa o suficiente para o prompt", rawSynopsis: "bruta tambem longa o bastante para uso", reviewDigest: null }
const rawOnly: InterestWorkData = { title: "Titulo", tags: ["a"], canonicalSynopsis: null, rawSynopsis: "bruta longa o suficiente para servir de fallback ok", reviewDigest: null }
const noSyn: InterestWorkData = { title: "Titulo", tags: ["a"], canonicalSynopsis: null, rawSynopsis: null, reviewDigest: null }

function sigFor(work: InterestWorkData, row: TasteProfileRow, source: SynopsisSource): string {
  return computeInterestInputSignature({
    workId: W,
    profileSignature: computeProfileSignature(row.profile),
    title: work.title,
    synopsis: (source === "canonical" ? work.canonicalSynopsis : work.rawSynopsis) ?? "",
    synopsisSource: source,
    tags: work.tags,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SYNOPSIS_INTEREST_SCHEMA_VERSION,
  })
}
function storedFor(work: InterestWorkData, row: TasteProfileRow, source: SynopsisSource, q: SynopsisQuality = "♥♥♥"): StoredPrediction {
  return { predictedQuality: q, inputSignature: sigFor(work, row, source), tasteProfileHash: computeProfileSignature(row.profile), stale: false }
}

class FakeGateway implements InterestGateway {
  work: InterestWorkData | null = null
  workSeq?: Array<InterestWorkData | null>
  private wIdx = 0
  stored: StoredPrediction | null = null
  storedSeq?: Array<StoredPrediction | null>
  private sIdx = 0
  consolidation: "queued" | "running" | null = null
  persistCalls = 0
  persisted: Parameters<InterestGateway["persistPrediction"]>[0] | null = null
  constructor(init: Partial<FakeGateway> = {}) {
    Object.assign(this, init)
  }
  async loadWork() {
    if (this.workSeq) {
      const v = this.workSeq[Math.min(this.wIdx, this.workSeq.length - 1)]
      this.wIdx++
      return v
    }
    return this.work
  }
  async loadCurrentPrediction() {
    if (this.storedSeq) {
      const v = this.storedSeq[Math.min(this.sIdx, this.storedSeq.length - 1)]
      this.sIdx++
      return v
    }
    return this.stored
  }
  async consolidationJobStatus() {
    return this.consolidation
  }
  async persistPrediction(args: Parameters<InterestGateway["persistPrediction"]>[0]) {
    this.persistCalls++
    this.persisted = args
    // espelha o efeito real (a linha passa a existir) — necessário p/ o waiter
    // do single-flight recarregar o resultado.
    this.stored = {
      predictedQuality: args.predictedQuality,
      inputSignature: args.inputSignature,
      tasteProfileHash: computeProfileSignature(args.profile.profile),
      stale: false,
    }
  }
}

const profileOutcome = (o: EnsureTasteProfileOutcome) => {
  const calls: EnsureTasteProfileDeps[] = []
  const fn = async (deps: EnsureTasteProfileDeps): Promise<EnsureTasteProfileOutcome> => {
    calls.push(deps)
    return o
  }
  return { fn, calls }
}

function fakePredict(state: { calls: number }, opts: { quality?: SynopsisQuality; fail?: string } = {}): DefaultPredictFn {
  return async () => {
    state.calls++
    if (opts.fail) throw new Error(opts.fail)
    return { predictedQuality: opts.quality ?? "♥♥♥", justification: "j", confidence: 0.7, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 }
  }
}

function base(gw: FakeGateway, profile: EnsureTasteProfileOutcome, state: { calls: number }, over: Partial<EnsurePredictInterestDeps> = {}): EnsurePredictInterestDeps {
  return { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: profileOutcome(profile).fn, predict: fakePredict(state), allowPaid: true, ...over }
}

// ---- assinatura + readiness (puro) -----------------------------------------

describe("assinatura + readiness", () => {
  const row = profileRow()
  it("18) prompt/schema/modelo entram na assinatura (mudança invalida)", () => {
    const p = { workId: W, profileSignature: "ps", title: "t", synopsis: "s", synopsisSource: "canonical" as const, tags: ["x"], model: "m", promptVersion: "v2", schemaVersion: "v1" }
    expect(computeInterestInputSignature(p)).not.toBe(computeInterestInputSignature({ ...p, promptVersion: "v3" }))
    expect(computeInterestInputSignature(p)).not.toBe(computeInterestInputSignature({ ...p, schemaVersion: "v2" }))
    expect(computeInterestInputSignature(p)).not.toBe(computeInterestInputSignature({ ...p, model: "m2" }))
  })
  it("ordem de tags não conta; mudança de conjunto conta", () => {
    const p = { workId: W, profileSignature: "ps", title: "t", synopsis: "s", synopsisSource: "canonical" as const, tags: ["a", "b"], model: "m", promptVersion: "v2", schemaVersion: "v1" }
    expect(computeInterestInputSignature(p)).toBe(computeInterestInputSignature({ ...p, tags: ["b", "a"] }))
    expect(computeInterestInputSignature(p)).not.toBe(computeInterestInputSignature({ ...p, tags: ["a", "c"] }))
  })
  it("dual-read: assinatura nova tem precedência; legado usa flag+hash", () => {
    const sig = sigFor(canonWork, row, "canonical")
    expect(classifyInterestReadiness({ currentSignature: sig, currentProfileSignature: computeProfileSignature(row.profile), stored: { predictedQuality: "♥♥♥", inputSignature: sig, tasteProfileHash: "x", stale: true } })).toBe("fresh")
    // legado (sem assinatura): flag stale ⇒ stale; hash igual ⇒ fresh
    expect(classifyInterestReadiness({ currentSignature: sig, currentProfileSignature: "ph", stored: { predictedQuality: "♥♥♥", inputSignature: null, tasteProfileHash: "ph", stale: false } })).toBe("fresh")
    expect(classifyInterestReadiness({ currentSignature: sig, currentProfileSignature: "ph", stored: { predictedQuality: "♥♥♥", inputSignature: null, tasteProfileHash: "ph", stale: true } })).toBe("stale")
    expect(classifyInterestReadiness({ currentSignature: sig, currentProfileSignature: "ph", stored: null })).toBe("absent")
  })
})

// ---- ensurePredictInterest -------------------------------------------------

describe("ensurePredictInterest (sem provider real)", () => {
  const row = profileRow()

  it("1) perfil fresh + previsão fresh ⇒ fresh, sem LLM", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor(canonWork, row, "canonical") })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("fresh")
    expect(st.calls).toBe(0)
  })

  it("2) perfil fresh + previsão ausente ⇒ prevê", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
    expect(gw.persistCalls).toBe(1)
  })

  it("3) perfil ausente, obras insuficientes ⇒ blocked_manual", async () => {
    const gw = new FakeGateway({ work: canonWork })
    const out = await ensurePredictInterest(W, base(gw, { status: "blocked_manual", ratedWorksCount: 5, required: 10, message: "avalie" }, { calls: 0 }))
    expect(out.status).toBe("blocked_manual")
  })

  it("4) perfil ausente, suficiente, sem autorização ⇒ blocked_cost_confirmation (cascata)", async () => {
    const gw = new FakeGateway({ work: canonWork })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "blocked_cost_confirmation", reason: "threshold", estimatedUsd: 0.58, likelyUsd: 0.39, ratedWorksCount: 192 }, st, { allowPaid: false }))
    expect(out.status).toBe("blocked_cost_confirmation")
    if (out.status === "blocked_cost_confirmation") {
      expect(out.reason).toBe("profile_cascade")
      expect(out.estimatedUsd).toBeGreaterThan(0.58) // perfil + previsão
    }
    expect(st.calls).toBe(0)
  })

  it("5) cascata autorizada ⇒ gera perfil (succeeded) e prevê", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "succeeded", profile: row, ranLlm: true, costUsd: 0.4 }, st))
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
  })

  it("6) perfil stale usado como bloqueio (sem acceptStale)", async () => {
    const gw = new FakeGateway({ work: canonWork })
    const out = await ensurePredictInterest(W, base(gw, { status: "stale", profile: row }, { calls: 0 }, { acceptStaleProfile: false }))
    expect(out.status).toBe("blocked_cost_confirmation")
  })

  it("7) perfil stale permitido como parcial", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "stale", profile: row }, st, { acceptStaleProfile: true }))
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") {
      expect(out.partial).toBe(true)
      expect(out.usedFallbacks).toContain("stale_profile")
    }
  })

  it("8) sem qualquer sinopse ⇒ blocked_manual", async () => {
    const gw = new FakeGateway({ work: noSyn })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    expect(out.status).toBe("blocked_manual")
    if (out.status === "blocked_manual") expect(out.reason).toBe("no_synopsis")
  })

  it("9) canonical fresh ⇒ source canonical, parcial=false", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.partial).toBe(false)
  })

  it("10) canonical ausente + raw fallback ⇒ parcial", async () => {
    const gw = new FakeGateway({ work: rawOnly, stored: null })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") {
      expect(out.partial).toBe(true)
      expect(out.usedFallbacks).toContain("raw_synopsis")
    }
  })

  it("11) consolidação em processamento ⇒ processing", async () => {
    const gw = new FakeGateway({ work: canonWork, consolidation: "running" })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    expect(out.status).toBe("processing")
    if (out.status === "processing") expect(out.reason).toBe("consolidating")
  })

  it("12) consolidação falhou + fallback bruto ⇒ parcial (não bloqueia)", async () => {
    const gw = new FakeGateway({ work: rawOnly, consolidation: null, stored: null })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.partial).toBe(true)
  })

  it("13) tags vazias ⇒ prevê normalmente", async () => {
    const gw = new FakeGateway({ work: { ...canonWork, tags: [] }, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
  })

  it("14) mudança de tags invalida ⇒ re-prevê", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor({ ...canonWork, tags: ["a", "z"] }, row, "canonical") })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
  })

  it("15) mudança de título invalida ⇒ re-prevê", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor({ ...canonWork, title: "Outro" }, row, "canonical") })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(st.calls).toBe(1)
    expect(out.status).toBe("succeeded")
  })

  it("16) mudança de sinopse invalida ⇒ re-prevê", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor({ ...canonWork, canonicalSynopsis: "sinopse diferente longa o suficiente aqui" }, row, "canonical") })
    const st = { calls: 0 }
    await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(st.calls).toBe(1)
  })

  it("17) mudança de perfil invalida ⇒ re-prevê", async () => {
    const newRow = profileRow(LOVED) // payload diferente ⇒ profile signature diferente
    const gw = new FakeGateway({ work: canonWork, stored: storedFor(canonWork, row, "canonical") }) // assinatura do perfil antigo
    const st = { calls: 0 }
    await ensurePredictInterest(W, base(gw, { status: "fresh", profile: newRow }, st))
    expect(st.calls).toBe(1)
  })

  it("19) duas concorrentes (mesma assinatura) ⇒ 1 LLM", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    const opts = { gateway: gw, jobStore: js, ensureProfile: profileOutcome({ status: "fresh", profile: row }).fn, predict: fakePredict(st), allowPaid: true }
    const [a, b] = await Promise.all([ensurePredictInterest(W, opts), ensurePredictInterest(W, opts)])
    expect(st.calls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
  })

  it("20) input muda DURANTE o job ⇒ descarta (não persiste assinatura antiga)", async () => {
    const gw = new FakeGateway({ stored: null })
    gw.workSeq = [canonWork, { ...canonWork, title: "Mudou no meio" }] // outer vs re-check dentro do job
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("stale")
    expect(st.calls).toBe(0) // não chamou o provider
    expect(gw.persistCalls).toBe(0) // não sobrescreveu
  })

  it("21) falha preserva o resultado anterior", async () => {
    const prev = storedFor({ ...canonWork, title: "Anterior" }, row, "canonical", "♥♥") // stale ⇒ tenta prever
    const gw = new FakeGateway({ work: canonWork, stored: prev })
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }, { predict: fakePredict({ calls: 0 }, { fail: "boom" }) }))
    expect(out.status).toBe("failed")
    expect(gw.persistCalls).toBe(0)
    expect(gw.stored).toBe(prev) // não apagado
  })

  it("22) resume ⇒ attempts incrementa, depois sucesso", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const js = new InMemoryJobStore()
    let fail = true
    const predict: DefaultPredictFn = async () => {
      if (fail) throw new Error("transient")
      return { predictedQuality: "♥♥♥", justification: "j", confidence: 0.5, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.01 }
    }
    const mk = () => ({ gateway: gw, jobStore: js, ensureProfile: profileOutcome({ status: "fresh", profile: row }).fn, predict, allowPaid: true })
    const first = await ensurePredictInterest(W, mk())
    expect(first.status).toBe("failed")
    __resetSingleFlight()
    fail = false
    const second = await ensurePredictInterest(W, mk())
    expect(second.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
    expect(js.records[0].attempts).toBe(2)
  })

  it("23) re-check encontra resultado fresh ⇒ não chama provider", async () => {
    const gw = new FakeGateway({ work: canonWork })
    gw.storedSeq = [null, storedFor(canonWork, row, "canonical")] // outer absent; re-check fresh
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, st))
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(0)
  })

  it("24) background NÃO gera perfil (perfil não-fresh ⇒ not_ready)", async () => {
    const gw = new FakeGateway({ work: canonWork })
    const cap = profileOutcome({ status: "stale", profile: row })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: cap.fn, predict: fakePredict(st), isBackground: true })
    expect(out.status).toBe("not_ready")
    expect(st.calls).toBe(0)
    expect(cap.calls[0].allowPaid).toBe(false) // não autoriza geração
    expect(cap.calls[0].refreshIfStale).toBe(false)
  })

  it("25) background não faz lote (trata 1 obra só)", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor(canonWork, row, "canonical") })
    const cap = profileOutcome({ status: "fresh", profile: row })
    const out = await ensurePredictInterest(W, { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: cap.fn, predict: fakePredict({ calls: 0 }), isBackground: true })
    expect(out.status).toBe("fresh")
    expect(cap.calls.length).toBe(1) // uma resolução de perfil, sem fan-out
  })

  it("26) individual abaixo do teto ⇒ auto mesmo sem allowPaid", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: profileOutcome({ status: "fresh", profile: row }).fn, predict: fakePredict(st), allowPaid: false })
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
  })

  it("27) individual acima do teto configurado ⇒ blocked", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const st = { calls: 0 }
    const out = await ensurePredictInterest(W, { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: profileOutcome({ status: "fresh", profile: row }).fn, predict: fakePredict(st), allowPaid: false, microThresholdUsd: 0.005 })
    expect(out.status).toBe("blocked_cost_confirmation")
    expect(st.calls).toBe(0)
  })

  it("29) payload mínimo (sem sinopse/tags/perfil)", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    const js = new InMemoryJobStore()
    await ensurePredictInterest(W, { gateway: gw, jobStore: js, ensureProfile: profileOutcome({ status: "fresh", profile: row }).fn, predict: fakePredict({ calls: 0 }), allowPaid: true })
    const job = js.records[0]
    expect(Object.keys(job.payload ?? {}).sort()).toEqual(["inputSignature", "model", "nTags", "profileSignature", "promptVersion", "schemaVersion", "synopsisSource", "workId"])
    const serialized = JSON.stringify(job.payload)
    expect(serialized).not.toContain("sinopse canonica") // sem texto da sinopse
    expect(job.dedupKey).toBe(interestDedupKey(W, sigFor(canonWork, row, "canonical")))
  })

  it("30) não toca em works.synopsis_quality (gateway só persiste a previsão)", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: null })
    await ensurePredictInterest(W, base(gw, { status: "fresh", profile: row }, { calls: 0 }))
    // o gateway não tem método de escrita do campo manual; só persistPrediction.
    expect(gw.persistCalls).toBe(1)
    expect(Object.keys(gw.persisted ?? {})).not.toContain("synopsisQuality")
  })
})

// ---- 28 + 31: lote (dry-run) -----------------------------------------------

describe("planInterestBatch (dry-run) + sem re-previsão global", () => {
  const row = profileRow()
  it("28) soma o custo TOTAL da cascata (perfil + previsões necessárias)", async () => {
    const gw = new FakeGateway()
    // 3 obras: 1 fresh (legado, hash bate), 2 sem previsão (absent)
    const ps = computeProfileSignature(row.profile)
    const seq: Array<StoredPrediction | null> = [
      { predictedQuality: "♥♥♥", inputSignature: null, tasteProfileHash: ps, stale: false }, // fresh
      null, // absent
      null, // absent
    ]
    gw.storedSeq = seq
    const plan = await planInterestBatch(["w1", "w2", "w3"], { gateway: gw, profileSignature: ps, profileNeedsGeneration: true, profileScale: 192 })
    expect(plan.total).toBe(3)
    expect(plan.fresh).toBe(1)
    expect(plan.stale + plan.absent).toBe(2)
    expect(plan.needsProfile).toBe(true)
    expect(plan.upperBoundUsd).toBeGreaterThan(plan.likelyUsd) // margem aplicada
    // o lote inclui a geração do perfil (não herda pré-autorização single-work)
    expect(plan.upperBoundUsd).toBeGreaterThan(0.3)
  })

  it("31) ensurePredictInterest cobre UMA obra (sem re-previsão global automática)", async () => {
    const gw = new FakeGateway({ work: canonWork, stored: storedFor(canonWork, row, "canonical") })
    const cap = profileOutcome({ status: "fresh", profile: row })
    const out = await ensurePredictInterest(W, { gateway: gw, jobStore: new InMemoryJobStore(), ensureProfile: cap.fn, predict: fakePredict({ calls: 0 }), allowPaid: true })
    expect(out.status).toBe("fresh") // uma obra; nenhuma varredura de catálogo
  })
})
