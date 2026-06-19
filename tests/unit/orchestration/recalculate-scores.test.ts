import { describe, it, expect, afterEach } from "vitest"
import {
  ensureRecalculateScores,
  recalcDedupKey,
  type RecalcPendingSnapshot,
} from "@/lib/orchestration/integrations/recalculate-scores"
import { InMemoryJobStore } from "@/lib/orchestration/jobs"
import { estimateStepUsd } from "@/lib/orchestration/cost"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

afterEach(() => __resetSingleFlight())

const pending = (lastEditAt: string | null = "2026-06-18T00:00:00Z"): RecalcPendingSnapshot => ({ pending: true, lastEditAt })
const notPending = (): Promise<RecalcPendingSnapshot> => Promise.resolve({ pending: false, lastEditAt: null })

function recalcFn(state: { calls: number }, opts: { count?: number; fail?: string } = {}) {
  return async () => {
    state.calls++
    if (opts.fail) throw new Error(opts.fail)
    return { recalculated: opts.count ?? 5 }
  }
}

describe("recalcDedupKey", () => {
  it("usa recalc_last_edit_at como geração; 'force' sem pendência", () => {
    expect(recalcDedupKey("2026-06-18T00:00:00Z")).toBe("recalculate_scores:2026-06-18T00:00:00Z")
    expect(recalcDedupKey(null)).toBe("recalculate_scores:force")
  })
})

describe("ensureRecalculateScores", () => {
  it("1) recalc_pending=false e sem force ⇒ fresh (sem job, sem cálculo)", async () => {
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({ recalc: recalcFn(st), readPending: notPending, jobStore: js })
    expect(out.status).toBe("fresh")
    expect(st.calls).toBe(0)
    expect(js.records.length).toBe(0)
  })

  it("2) recalc_pending=true ⇒ job global free + executa + succeeded", async () => {
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({ recalc: recalcFn(st, { count: 7 }), readPending: () => Promise.resolve(pending()), jobStore: js })
    expect(out.status).toBe("succeeded")
    if (out.status === "succeeded") expect(out.recalculated).toBe(7)
    expect(st.calls).toBe(1)
    const job = js.records[0]
    expect(job.workId).toBeNull() // GLOBAL
    expect(job.costEstimateUsd).toBe(0) // FREE
    expect(job.costActualUsd).toBe(0)
    expect(Object.keys(job.payload ?? {}).sort()).toEqual(["forced", "generation"])
  })

  it("3) force + sem pendência ⇒ executa (create / Recalcular agora)", async () => {
    const st = { calls: 0 }
    const out = await ensureRecalculateScores({ force: true, recalc: recalcFn(st), readPending: notPending, jobStore: new InMemoryJobStore() })
    expect(out.status).toBe("succeeded")
    expect(st.calls).toBe(1)
  })

  it("3b) contrato é FREE (estimativa 0)", () => {
    expect(estimateStepUsd("recalculate_scores")).toBe(0)
  })

  it("4) duas chamadas concorrentes (mesma geração) ⇒ uma execução, um job", async () => {
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    const deps = { recalc: recalcFn(st), readPending: () => Promise.resolve(pending()), jobStore: js }
    const [a, b] = await Promise.all([ensureRecalculateScores(deps), ensureRecalculateScores(deps)])
    expect(st.calls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
  })

  it("5) falha ⇒ failed, erro sanitizado", async () => {
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    const out = await ensureRecalculateScores({ recalc: recalcFn(st, { fail: "boom sk-supersecrettoken12345" }), readPending: () => Promise.resolve(pending()), jobStore: js })
    expect(out.status).toBe("failed")
    if (out.status === "failed") expect(out.error).toContain("[REDACTED]")
    expect(js.records[0].status).toBe("failed")
  })

  it("6) retry/resume ⇒ attempts incrementa, depois sucesso (mesma geração)", async () => {
    const js = new InMemoryJobStore()
    let fail = true
    const recalc = async () => {
      if (fail) throw new Error("transient")
      return { recalculated: 3 }
    }
    const deps = { recalc, readPending: () => Promise.resolve(pending()), jobStore: js }
    const first = await ensureRecalculateScores(deps)
    expect(first.status).toBe("failed")
    __resetSingleFlight()
    fail = false
    const second = await ensureRecalculateScores(deps)
    expect(second.status).toBe("succeeded")
    expect(js.records.length).toBe(1)
    expect(js.records[0].attempts).toBe(2)
  })

  it("7) nova geração (recalc_last_edit_at diferente) ⇒ novo job permitido", async () => {
    const st = { calls: 0 }
    const js = new InMemoryJobStore()
    await ensureRecalculateScores({ recalc: recalcFn(st), readPending: () => Promise.resolve(pending("T1")), jobStore: js })
    __resetSingleFlight()
    await ensureRecalculateScores({ recalc: recalcFn(st), readPending: () => Promise.resolve(pending("T2")), jobStore: js })
    expect(st.calls).toBe(2)
    expect(js.records.length).toBe(2)
  })

  it("9) regressão: a contagem do recalc é repassada SEM modificação", async () => {
    const out = await ensureRecalculateScores({ recalc: async () => ({ recalculated: 123 }), readPending: () => Promise.resolve(pending()), jobStore: new InMemoryJobStore() })
    expect(out.status === "succeeded" && out.recalculated).toBe(123)
  })
})
