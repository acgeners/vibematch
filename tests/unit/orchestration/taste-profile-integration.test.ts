import { describe, it, expect, afterEach } from "vitest"
import {
  ensureTasteProfile,
  classifyTasteProfileReadiness,
  tasteProfileDedupKey,
  type TasteProfileGateway,
} from "@/lib/orchestration/integrations/taste-profile"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { computeInputHash } from "@/lib/ai-recommendation/taste-profile"
import type { RatedWorkInput, TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

const EMPTY_PAYLOAD: TasteProfilePayload = {
  loved_tags: [],
  avoided_tags: [],
  loved_themes: [],
  avoided_themes: [],
  criterion_preferences: {},
  narrative_patterns: [],
  summary: "",
}

function makeProfile(over: Partial<TasteProfileRow> = {}): TasteProfileRow {
  return {
    id: "p",
    version: 1,
    is_current: true,
    is_stub: false,
    n_works_used: 12,
    input_hash: "h",
    model_name: "claude-sonnet-4-6",
    prompt_version: "v1",
    profile: EMPTY_PAYLOAD,
    raw_response: null,
    created_at: new Date().toISOString(),
    ...over,
  }
}

function ratedWorks(n: number, score = 8): RatedWorkInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    title: `t${i}`,
    userScore: score,
    postScores: {},
    personalStatus: null,
    synopsis: null,
    categoryScores: {},
    tags: [],
  }))
}

class FakeGateway implements TasteProfileGateway {
  current: TasteProfileRow | null = null
  works: RatedWorkInput[] = []
  genCalls = 0
  failGen?: string
  markedOldNonCurrent = false
  markedPredictionsStale = false
  rePredictCalled = false // nunca deve virar true (ensureTasteProfile não re-prevê)
  currentSeq?: Array<TasteProfileRow | null>
  private idx = 0
  constructor(init: Partial<FakeGateway> = {}) {
    Object.assign(this, init)
  }
  async loadCurrent() {
    if (this.currentSeq) {
      const v = this.currentSeq[Math.min(this.idx, this.currentSeq.length - 1)]
      this.idx++
      return v
    }
    return this.current
  }
  async loadRatedWorks() {
    return this.works
  }
  async generateAndPersist(_rw: RatedWorkInput[], hash: string) {
    this.genCalls++
    if (this.failGen) throw new Error(this.failGen)
    // simula efeitos de insertNewTasteProfile
    this.markedOldNonCurrent = true // markAllProfilesAsStale
    this.markedPredictionsStale = true // markSynopsisPredictionsStale
    const profile = makeProfile({ id: `p${this.genCalls}`, version: 1 + this.genCalls, input_hash: hash, is_current: true, is_stub: false })
    this.current = profile
    return { profile, costUsd: 0.21 }
  }
}

const ALLOW = { allowPaid: true }

// ---- readiness puro ---------------------------------------------------------

describe("classifyTasteProfileReadiness", () => {
  const fp = (loved: string[]) => ({ loved, avoided: [] as string[], criteria: [] as string[] })
  const NOW = Date.parse("2026-07-05T00:00:00.000Z")
  const RECENT = "2026-07-01T00:00:00.000Z"
  const cur = (over: Partial<{ isStub: boolean; inputHash: string; fingerprint: ReturnType<typeof fp> | null; nWorks: number; createdAt: string | null }> = {}) => ({
    isStub: false, inputHash: "h", fingerprint: fp(["a", "b"]), nWorks: 12, createdAt: RECENT, ...over,
  })
  const lib = { libraryHash: "h", libraryFingerprint: fp(["a", "b"]), libraryNWorks: 12, nowMs: NOW }

  it("absent / stub", () => {
    expect(classifyTasteProfileReadiness({ current: null, ...lib }).state).toBe("absent")
    expect(classifyTasteProfileReadiness({ current: cur({ isStub: true }), ...lib }).state).toBe("stub")
  })
  it("input igual ⇒ fresh", () => {
    expect(classifyTasteProfileReadiness({ current: cur(), ...lib }).state).toBe("fresh")
  })
  it("input mudou mas gosto IMATERIAL (mesmo fingerprint) ⇒ fresh (novo gate)", () => {
    expect(classifyTasteProfileReadiness({ current: cur({ inputHash: "old" }), ...lib }).state).toBe("fresh")
  })
  it("input mudou e gosto MATERIAL (fingerprint divergiu) ⇒ stale", () => {
    expect(
      classifyTasteProfileReadiness({
        current: cur({ inputHash: "old", fingerprint: fp(["a", "b", "c", "d"]) }),
        ...lib,
        libraryFingerprint: fp(["w", "x", "y", "z"]),
      }).state,
    ).toBe("stale")
  })
  it("sem fingerprint (legado) + input mudou ⇒ stale (fallback input_hash)", () => {
    expect(classifyTasteProfileReadiness({ current: cur({ inputHash: "old", fingerprint: null }), ...lib }).state).toBe("stale")
  })
})

// ---- 1..20 -----------------------------------------------------------------

describe("ensureTasteProfile (sem provider real)", () => {
  it("1) perfil fresh ⇒ retorna já, sem job, sem LLM", async () => {
    const works = ratedWorks(12)
    const gw = new FakeGateway({ works, current: makeProfile({ is_stub: false, input_hash: computeInputHash(works) }) })
    const js = new InMemoryJobStore()
    const out = await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(out.status).toBe("fresh")
    expect(gw.genCalls).toBe(0)
    expect(js.records.length).toBe(0)
  })

  it("2) ausente + obras insuficientes ⇒ blocked_manual", async () => {
    const gw = new FakeGateway({ works: ratedWorks(5), current: null })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("blocked_manual")
    if (out.status === "blocked_manual") {
      expect(out.ratedWorksCount).toBe(5)
      expect(out.required).toBe(10)
    }
    expect(gw.genCalls).toBe(0)
  })

  it("3) stub + obras insuficientes ⇒ blocked_manual", async () => {
    const gw = new FakeGateway({ works: ratedWorks(6), current: makeProfile({ is_stub: true }) })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("blocked_manual")
    expect(gw.genCalls).toBe(0)
  })

  it("4) ausente + obras suficientes (autorizado) ⇒ gera", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.ranLlm).toBe(true)
    expect(gw.genCalls).toBe(1)
  })

  it("5) stale SEM autorização ⇒ blocked_cost_confirmation (não regenera)", async () => {
    const works = ratedWorks(12)
    const gw = new FakeGateway({ works, current: makeProfile({ is_stub: false, input_hash: "antigo" }) })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), allowPaid: false, refreshIfStale: true })
    expect(out.status).toBe("blocked_cost_confirmation")
    if (out.status === "blocked_cost_confirmation") expect(out.reason).toBe("threshold")
    expect(gw.genCalls).toBe(0)
  })

  it("5b) stale + refreshIfStale=false ⇒ devolve o perfil anterior (leitura aceita stale)", async () => {
    const works = ratedWorks(12)
    const prev = makeProfile({ is_stub: false, input_hash: "antigo" })
    const gw = new FakeGateway({ works, current: prev })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), allowPaid: false, refreshIfStale: false })
    expect(out.status).toBe("stale")
    if (out.status === "stale") expect(out.profile).toBe(prev)
    expect(gw.genCalls).toBe(0)
  })

  it("6) stale COM autorização ⇒ regenera", async () => {
    const works = ratedWorks(12)
    const gw = new FakeGateway({ works, current: makeProfile({ is_stub: false, input_hash: "antigo" }) })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("succeeded")
    expect(gw.genCalls).toBe(1)
  })

  it("7) custo acima do teto ⇒ blocked over_cap", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), allowPaid: true, maxCostUsd: 0.01 })
    expect(out.status).toBe("blocked_cost_confirmation")
    if (out.status === "blocked_cost_confirmation") expect(out.reason).toBe("over_cap")
    expect(gw.genCalls).toBe(0)
  })

  it("8) duas concorrentes (mesmo hash) ⇒ 1 LLM, 1 job", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    const js = new InMemoryJobStore()
    const opts = { gateway: gw, jobStore: js, ...ALLOW }
    const [a, b] = await Promise.all([ensureTasteProfile(opts), ensureTasteProfile(opts)])
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(gw.genCalls).toBe(1)
    expect(js.records.length).toBe(1)
  })

  it("9) hashes diferentes ⇒ novo job permitido", async () => {
    const js = new InMemoryJobStore()
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    __resetSingleFlight()
    gw.works = ratedWorks(12, 9) // userScore diferente ⇒ input_hash diferente
    const out2 = await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(out2.status).toBe("succeeded")
    expect(gw.genCalls).toBe(2)
    expect(js.records.length).toBe(2)
  })

  it("10) falha persistida ⇒ failed, erro sanitizado", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null, failGen: "boom sk-supersecrettoken12345" })
    const js = new InMemoryJobStore()
    const out = await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(out.status).toBe("failed")
    expect(js.records[0].status).toBe("failed")
    expect(js.records[0].lastError).toContain("[REDACTED]")
  })

  it("11) resume ⇒ attempts incrementa, depois sucesso", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null, failGen: "transient" })
    const js = new InMemoryJobStore()
    const first = await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(first.status).toBe("failed")
    __resetSingleFlight()
    gw.failGen = undefined
    const second = await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(second.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
    expect(js.records[0].attempts).toBe(2)
  })

  it("12) re-check encontra perfil fresh ⇒ NÃO chama gerador", async () => {
    const works = ratedWorks(12)
    const hash = computeInputHash(works)
    const gw = new FakeGateway({ works })
    // outer loadCurrent ⇒ null (gera); inner re-check ⇒ fresh (outro processo gerou)
    gw.currentSeq = [null, makeProfile({ is_stub: false, input_hash: hash })]
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.ranLlm).toBe(false)
    expect(gw.genCalls).toBe(0)
  })

  it("13) perfil anterior preservado quando a geração falha", async () => {
    const works = ratedWorks(12)
    const prev = makeProfile({ id: "anterior", is_stub: false, input_hash: "antigo" })
    const gw = new FakeGateway({ works, current: prev, failGen: "x" })
    const out = await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(out.status).toBe("failed")
    expect(gw.current).toBe(prev) // não substituído
  })

  it("14) nova versão dispara a marcação do anterior como não-atual", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(gw.markedOldNonCurrent).toBe(true)
  })

  it("15) novo perfil dispara marcação de previsões stale", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(gw.markedPredictionsStale).toBe(true)
  })

  it("16) nenhuma re-previsão automática", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    await ensureTasteProfile({ gateway: gw, jobStore: new InMemoryJobStore(), ...ALLOW })
    expect(gw.rePredictCalled).toBe(false)
  })

  it("17) caller de leitura (refreshIfStale=false) não gera custo", async () => {
    const works = ratedWorks(12)
    const gw = new FakeGateway({ works, current: makeProfile({ is_stub: false, input_hash: "antigo" }) })
    const js = new InMemoryJobStore()
    const out = await ensureTasteProfile({ gateway: gw, jobStore: js, allowPaid: false, refreshIfStale: false })
    expect(out.status).toBe("stale")
    expect(gw.genCalls).toBe(0)
    expect(js.records.length).toBe(0)
  })

  it("18) caller automático (allowPaid=false) NÃO gera perfil silenciosamente", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    const js = new InMemoryJobStore()
    const out = await ensureTasteProfile({ gateway: gw, jobStore: js, allowPaid: false })
    expect(out.status).toBe("blocked_cost_confirmation")
    expect(gw.genCalls).toBe(0)
    expect(js.records.length).toBe(0)
  })

  it("19) payload mínimo (input_hash/n/model/promptVersion, sem obras/notas)", async () => {
    const works = ratedWorks(12)
    const gw = new FakeGateway({ works, current: null })
    const js = new InMemoryJobStore()
    await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    const job = js.records[0]
    expect(Object.keys(job.payload ?? {}).sort()).toEqual(["inputHash", "model", "n", "promptVersion"])
    expect(JSON.stringify(job.payload)).not.toContain("w0") // nenhum id de obra
    expect(job.dedupKey).toBe(tasteProfileDedupKey(computeInputHash(works)))
  })

  it("20) job global ⇒ work_id null", async () => {
    const gw = new FakeGateway({ works: ratedWorks(12), current: null })
    const js = new InMemoryJobStore()
    await ensureTasteProfile({ gateway: gw, jobStore: js, ...ALLOW })
    expect(js.records[0].workId).toBeNull()
  })
})
