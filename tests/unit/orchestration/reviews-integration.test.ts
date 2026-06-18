import { describe, it, expect, afterEach } from "vitest"
import {
  ensureReviewSummary,
  ensureReviewDigest,
  classifySummaryReadiness,
  classifyDigestReadiness,
  summaryDedupKey,
  type SummaryGateway,
  type DigestGateway,
} from "@/lib/orchestration/integrations/reviews"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import {
  hashReviewInputs,
  packReviewSummaryMeta,
  REVIEW_DIGEST_VERSION,
  type ConsolidateReviewsStatus,
  type ConsolidateDigestStatus,
  type ReviewSummaryInput,
  type ReviewDigestInput,
} from "@/lib/ai-recommendation/review-summarizer"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const HAIKU = "claude-haiku-4-5-20251001"
const SONNET = "claude-sonnet-4-6"
const W = "work-1"
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

afterEach(() => __resetSingleFlight())

// ---- fixtures --------------------------------------------------------------

const rev = (n: number, tag = "r"): ReviewSummaryInput[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `${tag} review numero ${i} com texto suficientemente longo para passar do piso de quarenta caracteres`,
    userRating: null,
  }))

const drev = (n: number, src = "anilist", tag = "r"): ReviewDigestInput[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `${tag} review ${i} com texto longo o suficiente para passar do piso de quarenta caracteres aqui`,
    source: src,
    userRating: null,
  }))

function summaryHash(reviews: ReviewSummaryInput[]): { hash: string; n: number } {
  const cleaned = reviews
    .map((r) => ({ text: r.text.trim(), userRating: r.userRating ?? null }))
    .filter((r) => r.text.length >= 40)
  const ordered = [...cleaned].sort((a, b) => a.text.localeCompare(b.text))
  return { hash: hashReviewInputs(ordered), n: ordered.length }
}

const DIGEST: ReviewDigest = { consensus: "c", divergence: "d", salient_traits: [], content_warnings: [], execution: "e" }

// ---- fakes -----------------------------------------------------------------

class FakeSummaryGateway implements SummaryGateway {
  summary: string | null = null
  meta: string | null = null
  writes = 0
  artifactSeq?: Array<{ summary: string | null; meta: string | null }>
  private idx = 0
  constructor(public reviews: ReviewSummaryInput[]) {}
  async readReviews() {
    return this.reviews
  }
  async readArtifact() {
    if (this.artifactSeq) {
      const v = this.artifactSeq[Math.min(this.idx, this.artifactSeq.length - 1)]
      this.idx++
      return { ...v }
    }
    return { summary: this.summary, meta: this.meta }
  }
  async writeArtifact(_id: string, v: { summary: string; hash: string; n: number; at: string }) {
    this.writes++
    this.summary = v.summary
    this.meta = packReviewSummaryMeta(v.hash, v.n)
  }
}

class FakeDigestGateway implements DigestGateway {
  digest: unknown = null
  version: string | null = null
  n: number | null = null
  writes = 0
  constructor(public reviews: ReviewDigestInput[]) {}
  async readReviews() {
    return this.reviews
  }
  async readArtifact() {
    return { digest: this.digest, version: this.version, n: this.n }
  }
  async writeArtifact(_id: string, v: { digest: ReviewDigest; n: number; at: string }) {
    this.writes++
    this.digest = v.digest
    this.n = v.n
    this.version = REVIEW_DIGEST_VERSION
  }
}

function summaryConsolidate(state: { calls: number }, mode: "ok" | { fail: string } = "ok") {
  return async (): Promise<ConsolidateReviewsStatus> => {
    state.calls++
    if (typeof mode === "object") return { kind: "api_failed", error: mode.fail }
    return { kind: "ok", result: { summary: "RESUMO", model: HAIKU, promptVersion: "v2", tokensIn: 1000, tokensOut: 100 } }
  }
}

function digestConsolidate(state: { calls: number }, mode: "ok" | { fail: string } = "ok") {
  return async (): Promise<ConsolidateDigestStatus> => {
    state.calls++
    if (typeof mode === "object") return { kind: "api_failed", error: mode.fail }
    return { kind: "ok", result: { digest: DIGEST, model: SONNET, promptVersion: REVIEW_DIGEST_VERSION, tokensIn: 3000, tokensOut: 500 } }
  }
}

// ---- readiness puro ---------------------------------------------------------

describe("classify readiness (puro, espelha os gates)", () => {
  it("summary: fresh quando hash bate; stale quando muda+material; immaterial quando muda+pequeno", () => {
    const { hash, n } = summaryHash(rev(5))
    expect(classifySummaryReadiness({ reviewCount: 5, currentHash: hash, nowN: n, storedSummary: "x", storedMeta: packReviewSummaryMeta(hash, n) }).state).toBe("fresh")
    expect(classifySummaryReadiness({ reviewCount: 12, currentHash: "novo", nowN: 12, storedSummary: "x", storedMeta: packReviewSummaryMeta("velho", 2) }).state).toBe("stale")
    expect(classifySummaryReadiness({ reviewCount: 3, currentHash: "novo", nowN: 3, storedSummary: "x", storedMeta: packReviewSummaryMeta("velho", 3) }).state).toBe("immaterial")
  })
  it("digest: absent/version/materiality/fresh", () => {
    expect(classifyDigestReadiness({ reviewCount: 5, nowN: 5, storedDigest: null, storedVersion: null, storedN: null }).state).toBe("absent")
    expect(classifyDigestReadiness({ reviewCount: 5, nowN: 5, storedDigest: {}, storedVersion: "old", storedN: 5 })).toEqual({ state: "stale", reason: "version" })
    expect(classifyDigestReadiness({ reviewCount: 12, nowN: 12, storedDigest: {}, storedVersion: REVIEW_DIGEST_VERSION, storedN: 2 })).toEqual({ state: "stale", reason: "materiality" })
    expect(classifyDigestReadiness({ reviewCount: 6, nowN: 6, storedDigest: {}, storedVersion: REVIEW_DIGEST_VERSION, storedN: 5 }).state).toBe("fresh")
  })
})

// ---- 1..20 -----------------------------------------------------------------

describe("ensureReviewSummary / ensureReviewDigest (sem provider real)", () => {
  it("1) sem reviews ⇒ not_ready, sem LLM, sem job", async () => {
    const calls = { calls: 0 }
    const gw = new FakeSummaryGateway([])
    const js = new InMemoryJobStore()
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("not_ready")
    expect(calls.calls).toBe(0)
    expect(js.records.length).toBe(0)
    expect(gw.writes).toBe(0)
  })

  it("2) reviews inalteradas + fresh ⇒ skipped, sem LLM, custo zero", async () => {
    const reviews = rev(5)
    const { hash, n } = summaryHash(reviews)
    const gw = new FakeSummaryGateway(reviews)
    gw.summary = "OLD"
    gw.meta = packReviewSummaryMeta(hash, n)
    const calls = { calls: 0 }
    const js = new InMemoryJobStore()
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out).toEqual({ status: "skipped", reason: "fresh" })
    expect(calls.calls).toBe(0)
    expect(js.records.length).toBe(0)
    expect(gw.writes).toBe(0)
  })

  it("3) summary ausente ⇒ gera (ranLlm), persiste", async () => {
    const gw = new FakeSummaryGateway(rev(6))
    const calls = { calls: 0 }
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") {
      expect(out.ranLlm).toBe(true)
      expect(out.costUsd).toBeGreaterThan(0)
    }
    expect(calls.calls).toBe(1)
    expect(gw.summary).toBe("RESUMO")
  })

  it("4) summary stale (hash muda + material) ⇒ regenera", async () => {
    const gw = new FakeSummaryGateway(rev(10))
    gw.summary = "OLD"
    gw.meta = packReviewSummaryMeta("hash-velho", 2)
    const calls = { calls: 0 }
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
    expect(gw.summary).toBe("RESUMO")
  })

  it("5) digest ausente ⇒ gera", async () => {
    const gw = new FakeDigestGateway(drev(6))
    const calls = { calls: 0 }
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: digestConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
    expect(gw.version).toBe(REVIEW_DIGEST_VERSION)
  })

  it("6) digest stale por VERSÃO ⇒ regenera", async () => {
    const gw = new FakeDigestGateway(drev(6))
    gw.digest = { consensus: "antigo" }
    gw.version = "digest-v0"
    gw.n = 6
    const calls = { calls: 0 }
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: digestConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
  })

  it("7) digest stale por MATERIALIDADE (versão atual, cresceu) ⇒ regenera", async () => {
    const gw = new FakeDigestGateway(drev(12))
    gw.digest = { consensus: "antigo" }
    gw.version = REVIEW_DIGEST_VERSION
    gw.n = 2
    const calls = { calls: 0 }
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: digestConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
  })

  it("8) duas execuções concorrentes (mesma assinatura) ⇒ 1 LLM, 1 job", async () => {
    const gw = new FakeSummaryGateway(rev(6))
    const js = new InMemoryJobStore()
    const calls = { calls: 0 }
    const fn = summaryConsolidate(calls)
    const opts = { gateway: gw, jobStore: js, consolidate: fn, allowPaid: true }
    const [a, b] = await Promise.all([ensureReviewSummary(W, opts), ensureReviewSummary(W, opts)])
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
    expect(js.records.length).toBe(1)
  })

  it("9) assinatura alterada ⇒ nova execução permitida (job succeeded antigo não bloqueia)", async () => {
    const js = new InMemoryJobStore()
    const calls = { calls: 0 }
    const gw1 = new FakeSummaryGateway(rev(2, "a"))
    await ensureReviewSummary(W, { gateway: gw1, jobStore: js, consolidate: summaryConsolidate(calls), allowPaid: true })
    __resetSingleFlight()
    // conjunto cresceu materialmente E mudou (hash novo) ⇒ stale ⇒ roda de novo
    const gw2 = new FakeSummaryGateway(rev(12, "b"))
    gw2.summary = gw1.summary
    gw2.meta = gw1.meta
    const out2 = await ensureReviewSummary(W, { gateway: gw2, jobStore: js, consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out2.status).toBe("succeeded")
    expect(calls.calls).toBe(2)
    expect(js.records.length).toBe(2)
  })

  it("10) falha do summary ⇒ failed, erro sanitizado, sem apagar anterior", async () => {
    const gw = new FakeSummaryGateway(rev(6))
    const js = new InMemoryJobStore()
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate: summaryConsolidate({ calls: 0 }, { fail: "provider down sk-supersecrettoken12345" }), allowPaid: true })
    expect(out.status).toBe("failed")
    expect(js.records[0].status).toBe("failed")
    expect(js.records[0].lastError).toContain("[REDACTED]")
    expect(gw.writes).toBe(0)
  })

  it("11) falha do digest ⇒ failed, sem apagar digest anterior", async () => {
    const gw = new FakeDigestGateway(drev(6))
    gw.digest = { consensus: "anterior valido" }
    gw.version = "digest-v0" // stale por versão ⇒ tentaria rodar
    gw.n = 6
    const js = new InMemoryJobStore()
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: js, consolidate: digestConsolidate({ calls: 0 }, { fail: "boom" }), allowPaid: true })
    expect(out.status).toBe("failed")
    expect(js.records[0].status).toBe("failed")
    expect(gw.digest).toEqual({ consensus: "anterior valido" }) // preservado
  })

  it("12) summary falha NÃO impede o digest (independentes)", async () => {
    const js = new InMemoryJobStore()
    const sgw = new FakeSummaryGateway(rev(6))
    const dgw = new FakeDigestGateway(drev(6))
    const s = await ensureReviewSummary(W, { gateway: sgw, jobStore: js, consolidate: summaryConsolidate({ calls: 0 }, { fail: "x" }), allowPaid: true })
    const d = await ensureReviewDigest(W, { gateway: dgw, jobStore: js, consolidate: digestConsolidate({ calls: 0 }), allowPaid: true })
    expect(s.status).toBe("failed")
    expect(d.status).toBe("succeeded")
  })

  it("13) retry encontra fresh no re-check ⇒ NÃO chama provider", async () => {
    const reviews = rev(6)
    const { hash, n } = summaryHash(reviews)
    const gw = new FakeSummaryGateway(reviews)
    // outer readArtifact ⇒ ausente (roda); inner re-check ⇒ fresh (outro processo gravou)
    gw.artifactSeq = [
      { summary: null, meta: null },
      { summary: "JA_PRODUZIDO", meta: packReviewSummaryMeta(hash, n) },
    ]
    const calls = { calls: 0 }
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: summaryConsolidate(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.ranLlm).toBe(false)
    expect(calls.calls).toBe(0)
  })

  it("14) job failed anterior permite resume (attempts incrementa, depois sucesso)", async () => {
    const gw = new FakeSummaryGateway(rev(6))
    const js = new InMemoryJobStore()
    let fail = true
    const consolidate = async (): Promise<ConsolidateReviewsStatus> => {
      if (fail) return { kind: "api_failed", error: "transient" }
      return { kind: "ok", result: { summary: "OK", model: HAIKU, promptVersion: "v2", tokensIn: 100, tokensOut: 20 } }
    }
    const first = await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate, allowPaid: true })
    expect(first.status).toBe("failed")
    __resetSingleFlight()
    fail = false
    const second = await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate, allowPaid: true })
    expect(second.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
    expect(js.records[0].attempts).toBe(2)
  })

  it("15) custo abaixo do micro-threshold (summary) ⇒ autoexecuta mesmo sem allowPaid", async () => {
    const gw = new FakeSummaryGateway(rev(6))
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: summaryConsolidate({ calls: 0 }), allowPaid: false })
    expect(out.status).toBe("succeeded")
  })

  it("16) custo acima do threshold (digest) sem allowPaid ⇒ blocked_cost_confirmation, sem LLM/job", async () => {
    const gw = new FakeDigestGateway(drev(6))
    const calls = { calls: 0 }
    const js = new InMemoryJobStore()
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: js, consolidate: digestConsolidate(calls), allowPaid: false })
    expect(out.status).toBe("blocked_cost_confirmation")
    if (out.status === "blocked_cost_confirmation") {
      expect(out.reason).toBe("threshold")
      expect(out.estimatedUsd).toBeGreaterThan(0.02)
    }
    expect(calls.calls).toBe(0)
    expect(js.records.length).toBe(0)
  })

  it("17) teto máximo excedido ⇒ blocked over_cap", async () => {
    const gw = new FakeDigestGateway(drev(6))
    const out = await ensureReviewDigest(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: digestConsolidate({ calls: 0 }), allowPaid: true, maxCostUsd: 0.005 })
    expect(out.status).toBe("blocked_cost_confirmation")
    if (out.status === "blocked_cost_confirmation") expect(out.reason).toBe("over_cap")
  })

  it("18) payload do job só com IDs/hashes/versões (sem conteúdo sensível)", async () => {
    const reviews = rev(6)
    const { hash } = summaryHash(reviews)
    const gw = new FakeSummaryGateway(reviews)
    const js = new InMemoryJobStore()
    await ensureReviewSummary(W, { gateway: gw, jobStore: js, consolidate: summaryConsolidate({ calls: 0 }), allowPaid: true })
    const job = js.records[0]
    expect(Object.keys(job.payload ?? {}).sort()).toEqual(["hash", "n", "promptVersion"])
    const serialized = JSON.stringify(job.payload) + job.dedupKey
    expect(serialized).not.toContain("review numero") // nada de texto de review
    expect(job.dedupKey).toBe(summaryDedupKey(W, hash))
  })

  it("19) resultado anterior preservado quando a geração falha", async () => {
    const gw = new FakeSummaryGateway(rev(12))
    gw.summary = "ANTERIOR_VALIDO"
    gw.meta = packReviewSummaryMeta("hash-velho", 2) // stale ⇒ tentaria rodar
    const out = await ensureReviewSummary(W, { gateway: gw, jobStore: new InMemoryJobStore(), consolidate: summaryConsolidate({ calls: 0 }, { fail: "x" }), allowPaid: true })
    expect(out.status).toBe("failed")
    expect(gw.summary).toBe("ANTERIOR_VALIDO") // não apagado
    expect(gw.writes).toBe(0)
  })

  it("20) digest não bloqueia (void) — a chamada não espera o provider lento", async () => {
    const sgw = new FakeSummaryGateway(rev(6))
    const dgw = new FakeDigestGateway(drev(6))
    const js = new InMemoryJobStore()
    let digestDone = false
    const slowDigest = async (): Promise<ConsolidateDigestStatus> => {
      await delay(40)
      digestDone = true
      return { kind: "ok", result: { digest: DIGEST, model: SONNET, promptVersion: REVIEW_DIGEST_VERSION, tokensIn: 1, tokensOut: 1 } }
    }
    // simula saveWorkReviews: summary aguardado, digest void (não aguardado)
    await ensureReviewSummary(W, { gateway: sgw, jobStore: js, consolidate: summaryConsolidate({ calls: 0 }), allowPaid: true })
    void ensureReviewDigest(W, { gateway: dgw, jobStore: js, consolidate: slowDigest, allowPaid: true })
    expect(digestDone).toBe(false) // o "save" não esperou o digest
    await delay(60) // deixa o job solto terminar (evita promessa pendente)
    expect(digestDone).toBe(true)
  })
})
