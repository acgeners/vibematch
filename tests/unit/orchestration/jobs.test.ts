import { describe, it, expect, afterEach, vi } from "vitest"
import {
  ABANDONED_JOB_THRESHOLD_MS,
  InMemoryJobStore,
  SupabaseJobStore,
  isAbandonedRunning,
  runOrchestratedJob,
  sanitizeErrorMessage,
} from "@/lib/orchestration/jobs"
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

/**
 * Regressão de 2026-08-10: `claim()` tratava `running` como ativo sem olhar idade e não
 * havia reaper, então job morto no meio (deploy/crash/timeout) travava a chave de dedup
 * PARA SEMPRE. Medido na nuvem: 3 digests presos desde 15–20/07 e 2 obras sem digest até
 * hoje, com toda nova tentativa voltando "já existe job ativo" — sem erro.
 *
 * ⚠️ Os dois lados precisam de teste: reivindicar cedo demais roda chamada PAGA 2×.
 */
describe("job preso em 'running' volta a ser reivindicável", () => {
  const envelhece = (store: InMemoryJobStore, ms: number) => {
    store.records[0].startedAt = new Date(Date.now() - ms).toISOString()
  }

  it("running RECENTE continua ativo — não reivindica job vivo", async () => {
    const store = new InMemoryJobStore()
    const c1 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kr" })
    await store.markRunning(c1.kind === "claimed" ? c1.job.id : "")
    envelhece(store, ABANDONED_JOB_THRESHOLD_MS - 60_000)

    const c2 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kr" })
    expect(c2.kind).toBe("active")
    expect(store.records.length).toBe(1)
  })

  it("running ABANDONADO é retomado na MESMA linha, com attempts+1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = new InMemoryJobStore()
    const c1 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kr" })
    const id = c1.kind === "claimed" ? c1.job.id : ""
    await store.markRunning(id)
    envelhece(store, ABANDONED_JOB_THRESHOLD_MS + 60_000)

    const c2 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kr" })
    expect(c2.kind).toBe("claimed")
    if (c2.kind === "claimed") {
      expect(c2.resumed).toBe(true)
      expect(c2.job.id).toBe(id)
      expect(c2.job.attempts).toBe(2)
      expect(c2.job.status).toBe("queued")
    }
    expect(store.records.length).toBe(1)
    // Retomar em silêncio troca um bug calado por outro — o log é a única medição.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("[jobs] retomando")
    warn.mockRestore()
  })

  it("o executor volta a RODAR a obra travada (era o sintoma: sem erro e sem nada feito)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = new InMemoryJobStore()
    const c1 = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kx" })
    await store.markRunning(c1.kind === "claimed" ? c1.job.id : "")
    envelhece(store, ABANDONED_JOB_THRESHOLD_MS + 60_000)

    let calls = 0
    const res = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: "w1", dedupKey: "kx" },
      async () => {
        calls += 1
      },
    )
    expect(calls).toBe(1)
    expect(res.status).not.toBe("processing")
    vi.restoreAllMocks()
  })

  it("isAbandonedRunning: só olha 'running', e cai pra createdAt sem startedAt", () => {
    const velho = new Date(Date.now() - ABANDONED_JOB_THRESHOLD_MS - 1000).toISOString()
    expect(isAbandonedRunning({ status: "running", startedAt: velho, createdAt: null })).toBe(true)
    expect(isAbandonedRunning({ status: "running", startedAt: null, createdAt: velho })).toBe(true)
    expect(isAbandonedRunning({ status: "queued", startedAt: velho, createdAt: velho })).toBe(false)
    expect(isAbandonedRunning({ status: "failed", startedAt: velho, createdAt: velho })).toBe(false)
    const novo = new Date().toISOString()
    expect(isAbandonedRunning({ status: "running", startedAt: novo, createdAt: novo })).toBe(false)
  })
})

/**
 * O store DURÁVEL é o que roda em produção, e o `.eq("status", …)` do update é o
 * compare-and-swap que segura a corrida. A 1ª versão tinha o literal `"failed"` ali —
 * com ele, a retomada de um `running` abandonado casaria 0 linhas e a obra seguiria
 * travada, agora em silêncio DUPLO (o claim diria "ativo" pelo caminho de fallback).
 */
describe("SupabaseJobStore — retomada de running abandonado", () => {
  function fakeClient(row: Record<string, unknown>) {
    const updates: Array<{ patch: Record<string, unknown>; guards: Array<[string, unknown]> }> = []
    const client = {
      from() {
        return {
          select: () => builderLeitura(),
          update(patch: Record<string, unknown>) {
            const guards: Array<[string, unknown]> = []
            const b = {
              eq(col: string, val: unknown) {
                guards.push([col, val])
                return b
              },
              select: () => b,
              maybeSingle: async () => {
                updates.push({ patch, guards })
                // Emula o WHERE: só devolve linha se todos os guards baterem.
                const bate = guards.every(([c, v]) => (c === "id" ? row.id === v : row[c] === v))
                if (!bate) return { data: null }
                Object.assign(row, patch)
                return { data: { ...row } }
              },
            }
            return b
          },
        }
      },
    }
    function builderLeitura() {
      const b = {
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: { ...row } }),
      }
      return b
    }
    return { client, updates }
  }

  it("reivindica a linha em running e não usa o literal 'failed' como guarda", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const row = {
      id: "j1",
      action: "generate_review_digest",
      work_id: "w1",
      dedup_key: "kd",
      status: "running",
      attempts: 1,
      created_at: new Date(Date.now() - ABANDONED_JOB_THRESHOLD_MS * 2).toISOString(),
      started_at: new Date(Date.now() - ABANDONED_JOB_THRESHOLD_MS * 2).toISOString(),
      finished_at: null,
    }
    const { client, updates } = fakeClient(row)
    const store = new SupabaseJobStore(client as never)

    const res = await store.claim({ action: "generate_review_digest", workId: "w1", dedupKey: "kd" })

    expect(res.kind).toBe("claimed")
    if (res.kind === "claimed") {
      expect(res.resumed).toBe(true)
      expect(res.job.id).toBe("j1")
      expect(res.job.attempts).toBe(2)
    }
    expect(updates).toHaveLength(1)
    expect(updates[0].patch.status).toBe("queued")
    expect(updates[0].guards).toContainEqual(["status", "running"])
    vi.restoreAllMocks()
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
