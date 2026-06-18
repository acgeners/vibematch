import { describe, it, expect, afterEach } from "vitest"
import { InMemoryJobStore, runOrchestratedJob } from "@/lib/orchestration/jobs"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

afterEach(() => __resetSingleFlight())

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

  it("falha marca o job failed e é retomável numa nova execução", async () => {
    const store = new InMemoryJobStore()
    const failing = runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: "w1", dedupKey: "k2" },
      async () => {
        throw new Error("boom")
      },
    )
    const first = await failing
    expect(first.status).toBe("failed")
    expect(store.records[0].status).toBe("failed")
    expect(store.records[0].lastError).toBe("boom")

    // Resume: mesma chave, agora bem-sucedida.
    const second = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: "w1", dedupKey: "k2" },
      async () => ({ costActualUsd: 0.01 }),
    )
    expect(second.status).toBe("succeeded")
    expect(store.records.length).toBe(2)
    expect(store.records[1].costActualUsd).toBe(0.01)
  })

  it("job já em voo (claim ativo) ⇒ processing, sem rodar fn", async () => {
    const store = new InMemoryJobStore()
    // Ocupa o dedup_key fora do single-flight.
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
