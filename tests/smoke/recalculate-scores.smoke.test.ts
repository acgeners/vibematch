/**
 * SMOKE de recalculate_scores × fila durável (passo 5).
 *
 * Gratuito e SEGURO: o recalc é NO-OP (não escreve calculated_scores nem mexe em
 * recalc_pending); o readPending é MOCKADO (não lê/escreve formula_config). Só
 * cria/apaga linhas próprias em work_processing_jobs (job GLOBAL, work_id=null)
 * via SupabaseJobStore real. Nenhum cálculo determinístico real é executado.
 * Relata recalc_pending antes/depois (read-only) — deve ficar INALTERADO.
 *
 * Habilite com:
 *   RUN_SMOKE=1 npx vitest run tests/smoke/recalculate-scores.smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { SupabaseJobStore } from "@/lib/orchestration/jobs"
import { ensureRecalculateScores, type RecalcPendingSnapshot } from "@/lib/orchestration/integrations/recalculate-scores"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const SMOKE = process.env.RUN_SMOKE === "1"
if (SMOKE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const ENABLED = SMOKE && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

const GEN = `2026-06-18T${Date.now() % 100000}` // geração única deste run (dedup_key exclusivo)
const pendingMock = (): Promise<RecalcPendingSnapshot> => Promise.resolve({ pending: true, lastEditAt: GEN })
const notPendingMock = (): Promise<RecalcPendingSnapshot> => Promise.resolve({ pending: false, lastEditAt: null })

describe.skipIf(!ENABLED)("SMOKE — recalculate_scores × fila durável", () => {
  let sb: ReturnType<typeof createAdminClient>
  let store: SupabaseJobStore
  let startedAt: string
  let recalcCalls = 0
  const noopRecalc = async () => {
    recalcCalls++
    return { recalculated: 0 } // NO-OP: não escreve nada funcional
  }

  beforeAll(async () => {
    sb = createAdminClient()
    store = new SupabaseJobStore(sb)
    startedAt = new Date(Date.now() - 1000).toISOString()
    const { data } = await sb.from("formula_config").select("recalc_pending").order("updated_at", { ascending: false }).limit(1).maybeSingle()
    console.log(`[SMOKE-RC] recalc_pending ANTES = ${JSON.stringify(data?.recalc_pending)}`)
  })

  afterAll(async () => {
    const { count } = await sb.from("work_processing_jobs").delete({ count: "exact" }).eq("action", "recalculate_scores").gte("created_at", startedAt)
    const { count: remaining } = await sb.from("work_processing_jobs").select("*", { count: "exact", head: true }).eq("action", "recalculate_scores").gte("created_at", startedAt)
    const { data } = await sb.from("formula_config").select("recalc_pending").order("updated_at", { ascending: false }).limit(1).maybeSingle()
    console.log(`[SMOKE-RC] recalc_pending DEPOIS = ${JSON.stringify(data?.recalc_pending)} (deve ser igual ao ANTES) · jobs removidos=${count ?? "?"} · residual=${remaining ?? "?"}`)
    expect(remaining ?? 0).toBe(0)
  })

  it("recalc_pending=false e sem force ⇒ fresh, nenhum job", async () => {
    const out = await ensureRecalculateScores({ recalc: noopRecalc, readPending: notPendingMock, jobStore: store })
    console.log(`[SMOKE-RC] fresh: status=${out.status} recalcCalls=${recalcCalls}`)
    expect(out.status).toBe("fresh")
    expect(recalcCalls).toBe(0)
  })

  it("pendente ⇒ job GLOBAL durável succeeded (work_id null, free)", async () => {
    __resetSingleFlight()
    const out = await ensureRecalculateScores({ recalc: noopRecalc, readPending: pendingMock, jobStore: store })
    expect(out.status).toBe("succeeded")
    const { data } = await sb
      .from("work_processing_jobs")
      .select("work_id, status, cost_estimate_usd, cost_actual_usd, payload, dedup_key")
      .eq("action", "recalculate_scores")
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as Record<string, unknown> | null
    console.log(`[SMOKE-RC] durável: work_id=${row?.work_id} status=${row?.status} est=${row?.cost_estimate_usd} actual=${row?.cost_actual_usd} dedup=${row?.dedup_key}`)
    expect(row?.work_id).toBeNull()
    expect(row?.status).toBe("succeeded")
    expect(Number(row?.cost_estimate_usd)).toBe(0)
    expect(Number(row?.cost_actual_usd)).toBe(0)
    expect(String(row?.dedup_key)).toBe(`recalculate_scores:${GEN}`)
  })

  it("guard de build: NEXT_PHASE=phase-production-build ⇒ fresh, nenhum job (mesmo pendente)", async () => {
    __resetSingleFlight()
    const orig = process.env.NEXT_PHASE
    process.env.NEXT_PHASE = "phase-production-build"
    try {
      const before = (await sb.from("work_processing_jobs").select("*", { count: "exact", head: true }).eq("action", "recalculate_scores").gte("created_at", startedAt)).count ?? 0
      const out = await ensureRecalculateScores({ recalc: noopRecalc, readPending: pendingMock, jobStore: store })
      const after = (await sb.from("work_processing_jobs").select("*", { count: "exact", head: true }).eq("action", "recalculate_scores").gte("created_at", startedAt)).count ?? 0
      console.log(`[SMOKE-RC] build-guard: status=${out.status} jobs_antes=${before} jobs_depois=${after}`)
      expect(out.status).toBe("fresh")
      expect(after).toBe(before) // nenhum job novo durante o "build"
    } finally {
      if (orig === undefined) delete process.env.NEXT_PHASE
      else process.env.NEXT_PHASE = orig
    }
  })

  it("duas concorrentes (mesma geração) ⇒ uma execução", async () => {
    __resetSingleFlight()
    recalcCalls = 0
    const deps = { recalc: noopRecalc, readPending: pendingMock, jobStore: store }
    const [a, b] = await Promise.all([ensureRecalculateScores(deps), ensureRecalculateScores(deps)])
    console.log(`[SMOKE-RC] concorrente: a=${a.status} b=${b.status} recalcCalls=${recalcCalls}`)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    expect(recalcCalls).toBe(1)
  })
})
