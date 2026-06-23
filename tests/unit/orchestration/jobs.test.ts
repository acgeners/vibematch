import { describe, it, expect, afterEach } from "vitest"
import { InMemoryJobStore, runOrchestratedJob, sanitizeErrorMessage } from "@/lib/orchestration/jobs"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

afterEach(() => __resetSingleFlight())

describe("InMemoryJobStore — ciclo de vida", () => {
  it("queued → running → succeeded com timestamps e custos", async () => {
    const store = new InMemoryJobStore()
    const claim = await store.claim({
      action: "consolidate_synopsis",
      workId: "w1",
      dedupKey: "k0",
      estimateUsd: 0.0075,
    })
    expect(claim.kind).toBe("claimed")
    const id = claim.kind === "claimed" ? claim.job.id : ""
    expect(store.records[0].status).toBe("queued")
    expect(store.records[0].attempts).toBe(1)
    expect(store.records[0].costEstimateUsd).toBe(0.0075)
    expect(store.records[0].createdAt).not.toBeNull()
    expect(store.records[0].startedAt).toBeNull()

    await store.markRunning(id)
    expect(store.records[0].status).toBe("running")
    expect(store.records[0].startedAt).not.toBeNull()

    await store.markSucceeded(id, { costActualUsd: 0.0061 })
    expect(store.records[0].status).toBe("succeeded")
    expect(store.records[0].costActualUsd).toBe(0.0061)
    expect(store.records[0].finishedAt).not.toBeNull()
  })

  it("retomada de job failed reusa a MESMA linha e incrementa attempts", async () => {
    const store = new InMemoryJobStore()
    const c1 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kf" })
    const id = c1.kind === "claimed" ? c1.job.id : ""
    await store.markRunning(id)
    await store.markFailed(id, { lastError: "boom" })
    expect(store.records[0].status).toBe("failed")
    expect(store.records[0].attempts).toBe(1)

    const c2 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kf" })
    expect(c2.kind).toBe("claimed")
    if (c2.kind === "claimed") {
      expect(c2.resumed).toBe(true)
      expect(c2.job.id).toBe(id) // mesma linha
      expect(c2.job.attempts).toBe(2)
      expect(c2.job.lastError).toBeNull()
    }
    expect(store.records.length).toBe(1)
  })
})

describe("runOrchestratedJob + InMemoryJobStore", () => {
  it("deduplica chamadas concorrentes com a mesma dedup_key (fn roda 1×)", async () => {
    const store = new InMemoryJobStore()
    let calls = 0
    const fn = async () => {
      await delay(10)
      calls += 1
    }
    const params = { action: "consolidate_synopsis" as const, workId: "w1", dedupKey: "k1" }
    const [a, b] = await Promise.all([
      runOrchestratedJob(store, params, fn),
      runOrchestratedJob(store, params, fn),
    ])
    expect(calls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(store.records.length).toBe(1)
  })

  it("dedup_keys diferentes não se bloqueiam (ambas executam)", async () => {
    const store = new InMemoryJobStore()
    let calls = 0
    const fn = async () => {
      await delay(5)
      calls += 1
    }
    const [a, b] = await Promise.all([
      runOrchestratedJob(store, { action: "consolidate_synopsis", workId: "w1", dedupKey: "ka" }, fn),
      runOrchestratedJob(store, { action: "consolidate_synopsis", workId: "w2", dedupKey: "kb" }, fn),
    ])
    expect(calls).toBe(2)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(store.records.length).toBe(2)
  })

  it("falha persiste failed (erro sanitizado) e é retomável na MESMA linha", async () => {
    const store = new InMemoryJobStore()
    const first = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: "w1", dedupKey: "k2" },
      async () => {
        throw new Error("boom\nsk-supersecrettoken12345 detalhe")
      },
    )
    expect(first.status).toBe("failed")
    expect(store.records[0].status).toBe("failed")
    expect(store.records[0].lastError).toContain("boom")
    expect(store.records[0].lastError).not.toContain("\n")
    expect(store.records[0].lastError).toContain("[REDACTED]")

    // Resume: mesma chave, agora bem-sucedida — reusa a linha, attempts=2.
    const second = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: "w1", dedupKey: "k2" },
      async () => ({ costActualUsd: 0.01 }),
    )
    expect(second.status).toBe("succeeded")
    expect(store.records.length).toBe(1)
    expect(store.records[0].attempts).toBe(2)
    expect(store.records[0].costActualUsd).toBe(0.01)
    expect(store.records[0].lastError).toBeNull()
  })

  it("job já em voo (claim ativo) ⇒ processing, sem rodar fn", async () => {
    const store = new InMemoryJobStore()
    await store.claim({ action: "acquire_reviews", workId: "w1", dedupKey: "k3" })
    let calls = 0
    const res = await runOrchestratedJob(
      store,
      { action: "acquire_reviews", workId: "w1", dedupKey: "k3" },
      async () => {
        calls += 1
      },
    )
    expect(res.status).toBe("processing")
    expect(calls).toBe(0)
  })
})

describe("sanitizeErrorMessage", () => {
  it("uma linha, trunca, e redige segredos", () => {
    expect(sanitizeErrorMessage(new Error("a\n\n b"))).toBe("a b")
    expect(sanitizeErrorMessage("Bearer abcd1234efgh")).toContain("[REDACTED]")
    expect(sanitizeErrorMessage("eyJhbGciOiJIUzI1NiJ9.payload")).toContain("[REDACTED]")
    const long = sanitizeErrorMessage("x".repeat(600))
    expect(long.length).toBeLessThanOrEqual(500)
  })
})
