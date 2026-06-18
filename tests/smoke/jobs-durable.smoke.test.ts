/**
 * SMOKE da fila durável (work_processing_jobs) — Etapa 2.
 *
 * Gratuito: NÃO chama LLM, NÃO toca dados funcionais (só insere/atualiza/apaga
 * linhas próprias em work_processing_jobs, com work_id=null e dedup_key 'smoke:…').
 * Callbacks são no-op. Os registros são removidos no afterAll.
 *
 * Desativado por padrão (não roda no `npm run test`). Habilite com:
 *   RUN_SMOKE=1 npx vitest run tests/smoke/jobs-durable.smoke.test.ts
 * As credenciais são lidas de .env.local (só quando RUN_SMOKE=1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  SupabaseJobStore,
  getJobStore,
  runOrchestratedJob,
  __resetJobStoreCache,
  type JobStore,
} from "@/lib/orchestration/jobs"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const SMOKE = process.env.RUN_SMOKE === "1"
if (SMOKE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const ENABLED = SMOKE && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe.skipIf(!ENABLED)("SMOKE — work_processing_jobs durável", () => {
  let sb: ReturnType<typeof createAdminClient>
  let store: SupabaseJobStore
  const RUN = `smoke:${Date.now()}`
  const k = (name: string) => `${RUN}:${name}`

  const readLatest = async (dedupKey: string) => {
    const { data } = await sb
      .from("work_processing_jobs")
      .select("*")
      .eq("dedup_key", dedupKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data as Record<string, unknown> | null
  }

  beforeAll(() => {
    sb = createAdminClient()
    store = new SupabaseJobStore(sb)
  })

  afterAll(async () => {
    const { count } = await sb
      .from("work_processing_jobs")
      .delete({ count: "exact" })
      .like("dedup_key", `${RUN}:%`)
    // Varredura de qualquer resíduo de smokes anteriores.
    await sb.from("work_processing_jobs").delete().like("dedup_key", "smoke:%")
    const { count: remaining } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .like("dedup_key", "smoke:%")
    console.log(`[SMOKE] cleanup: removidas ${count ?? "?"} linhas deste run; residual 'smoke:%' = ${remaining ?? "?"}`)
    expect(remaining ?? 0).toBe(0)
  })

  it("getJobStore resolve o SupabaseJobStore (tabela existe)", async () => {
    __resetJobStoreCache()
    const resolved: JobStore = await getJobStore(sb)
    console.log(`[SMOKE] getJobStore ⇒ ${resolved.constructor.name}`)
    expect(resolved).toBeInstanceOf(SupabaseJobStore)
  })

  it("ciclo queued → running → succeeded (custos + timestamps)", async () => {
    const claim = await store.claim({ action: "consolidate_synopsis", workId: null, dedupKey: k("life"), estimateUsd: 0.0075 })
    expect(claim.kind).toBe("claimed")
    const id = claim.kind === "claimed" ? claim.job.id : ""

    const q = await readLatest(k("life"))
    console.log(`[SMOKE] queued: status=${q?.status} attempts=${q?.attempts} est=${q?.cost_estimate_usd} created=${q?.created_at} started=${q?.started_at}`)
    expect(q?.status).toBe("queued")
    expect(Number(q?.attempts)).toBe(1)
    expect(Number(q?.cost_estimate_usd)).toBeCloseTo(0.0075)
    expect(q?.started_at).toBeNull()

    await store.markRunning(id)
    const r = await readLatest(k("life"))
    console.log(`[SMOKE] running: status=${r?.status} started=${r?.started_at}`)
    expect(r?.status).toBe("running")
    expect(r?.started_at).not.toBeNull()

    await store.markSucceeded(id, { costActualUsd: 0.0061 })
    const s = await readLatest(k("life"))
    console.log(`[SMOKE] succeeded: status=${s?.status} actual=${s?.cost_actual_usd} finished=${s?.finished_at}`)
    expect(s?.status).toBe("succeeded")
    expect(Number(s?.cost_actual_usd)).toBeCloseTo(0.0061)
    expect(s?.finished_at).not.toBeNull()
  })

  it("dedup concorrente: mesma dedup_key ⇒ fn roda 1×, 1 linha", async () => {
    __resetSingleFlight()
    let calls = 0
    const fn = async () => {
      await delay(20)
      calls += 1
      return { costActualUsd: 0.002 }
    }
    const params = { action: "consolidate_synopsis" as const, workId: null, dedupKey: k("dedup") }
    const [a, b] = await Promise.all([
      runOrchestratedJob(store, params, fn),
      runOrchestratedJob(store, params, fn),
    ])
    const { count } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("dedup_key", k("dedup"))
    console.log(`[SMOKE] dedup concorrente: calls=${calls} a=${a.status} b=${b.status} linhas=${count}`)
    expect(calls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(count).toBe(1)
  })

  it("dedup_keys diferentes não se bloqueiam", async () => {
    __resetSingleFlight()
    let calls = 0
    const fn = async () => {
      await delay(10)
      calls += 1
    }
    const [a, b] = await Promise.all([
      runOrchestratedJob(store, { action: "consolidate_synopsis", workId: null, dedupKey: k("ind-a") }, fn),
      runOrchestratedJob(store, { action: "consolidate_synopsis", workId: null, dedupKey: k("ind-b") }, fn),
    ])
    console.log(`[SMOKE] independentes: calls=${calls} a=${a.status} b=${b.status}`)
    expect(calls).toBe(2)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
  })

  it("dedup CROSS-PROCESSO no índice único: claim duplo ⇒ segundo é 'active'", async () => {
    const first = await store.claim({ action: "acquire_reviews", workId: null, dedupKey: k("xproc") })
    const second = await store.claim({ action: "acquire_reviews", workId: null, dedupKey: k("xproc") })
    console.log(`[SMOKE] cross-process: first=${first.kind} second=${second.kind}`)
    expect(first.kind).toBe("claimed")
    expect(second.kind).toBe("active")
    if (first.kind === "claimed") await store.markSucceeded(first.job.id)
  })

  it("falha persistida + attempts + erro sanitizado + resume bem-sucedido", async () => {
    __resetSingleFlight()
    const fail = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: null, dedupKey: k("fail"), estimateUsd: 0.013 },
      async () => {
        throw new Error("falha simulada do smoke\nsk-supersecrettoken12345 detalhe")
      },
    )
    expect(fail.status).toBe("failed")
    const f = await readLatest(k("fail"))
    console.log(`[SMOKE] failed: status=${f?.status} attempts=${f?.attempts} last_error=${JSON.stringify(f?.last_error)} finished=${f?.finished_at}`)
    expect(f?.status).toBe("failed")
    expect(Number(f?.attempts)).toBe(1)
    expect(String(f?.last_error)).toContain("falha simulada")
    expect(String(f?.last_error)).not.toContain("\n")
    expect(String(f?.last_error)).toContain("[REDACTED]")
    expect(f?.finished_at).not.toBeNull()

    __resetSingleFlight()
    const resume = await runOrchestratedJob(
      store,
      { action: "generate_review_digest", workId: null, dedupKey: k("fail") },
      async () => ({ costActualUsd: 0.012 }),
    )
    expect(resume.status).toBe("succeeded")
    const s = await readLatest(k("fail"))
    console.log(`[SMOKE] resume: id_igual=${s?.id === f?.id} status=${s?.status} attempts=${s?.attempts} actual=${s?.cost_actual_usd} last_error=${JSON.stringify(s?.last_error)}`)
    expect(s?.id).toBe(f?.id) // MESMA linha
    expect(s?.status).toBe("succeeded")
    expect(Number(s?.attempts)).toBe(2)
    expect(Number(s?.cost_actual_usd)).toBeCloseTo(0.012)
    expect(s?.last_error).toBeNull()
  })
})
