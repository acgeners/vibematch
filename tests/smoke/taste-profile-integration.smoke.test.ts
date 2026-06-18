/**
 * SMOKE da integração ensure_taste_profile × fila durável (Etapa/passo 3).
 *
 * Gratuito: NÃO chama LLM (gerador no-op) e NÃO altera dados funcionais — o
 * gateway é EM MEMÓRIA (taste_profile nunca é escrito). Só cria/apaga linhas
 * próprias em work_processing_jobs (job GLOBAL, work_id=null) via SupabaseJobStore
 * real. Limpa cirurgicamente (action + created_at >= início) no afterAll.
 *
 * Desativado por padrão. Habilite com:
 *   RUN_SMOKE=1 npx vitest run tests/smoke/taste-profile-integration.smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { SupabaseJobStore } from "@/lib/orchestration/jobs"
import { ensureTasteProfile, type TasteProfileGateway } from "@/lib/orchestration/integrations/taste-profile"
import type { RatedWorkInput, TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const SMOKE = process.env.RUN_SMOKE === "1"
if (SMOKE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const ENABLED = SMOKE && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

const RUN = `smoke-tp-${Date.now()}`
const EMPTY: TasteProfilePayload = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const prof = (over: Partial<TasteProfileRow> = {}): TasteProfileRow => ({
  id: "p", version: 2, is_current: true, is_stub: false, n_works_used: 12, input_hash: "h", model_name: "claude-sonnet-4-6", prompt_version: "v1", profile: EMPTY, raw_response: null, created_at: new Date().toISOString(), ...over,
})
// ids únicos por run ⇒ input_hash exclusivo deste smoke (dedup_key não colide).
const works = (n: number): RatedWorkInput[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${RUN}-w${i}`, title: `t${i}`, userScore: 8, postScores: {}, personalStatus: null, synopsis: null, categoryScores: {}, tags: [] }))

class MemGateway implements TasteProfileGateway {
  current: TasteProfileRow | null = null
  genCalls = 0
  constructor(public ratedWorks: RatedWorkInput[]) {}
  async loadCurrent() {
    return this.current
  }
  async loadRatedWorks() {
    return this.ratedWorks
  }
  async generateAndPersist(_rw: RatedWorkInput[], hash: string) {
    this.genCalls++
    const p = prof({ input_hash: hash })
    this.current = p
    return { profile: p, costUsd: 0.21 }
  }
}

describe.skipIf(!ENABLED)("SMOKE — ensure_taste_profile × fila durável", () => {
  let sb: ReturnType<typeof createAdminClient>
  let store: SupabaseJobStore
  let startedAt: string

  beforeAll(() => {
    sb = createAdminClient()
    store = new SupabaseJobStore(sb)
    startedAt = new Date(Date.now() - 1000).toISOString()
  })

  afterAll(async () => {
    const { count } = await sb
      .from("work_processing_jobs")
      .delete({ count: "exact" })
      .eq("action", "ensure_taste_profile")
      .gte("created_at", startedAt)
    const { count: remaining } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("action", "ensure_taste_profile")
      .gte("created_at", startedAt)
    console.log(`[SMOKE-TP] cleanup: removidas ${count ?? "?"}; residual = ${remaining ?? "?"}`)
    expect(remaining ?? 0).toBe(0)
  })

  it("obras insuficientes ⇒ blocked_manual, nenhum job", async () => {
    const gw = new MemGateway(works(5))
    const out = await ensureTasteProfile({ gateway: gw, jobStore: store, allowPaid: true })
    console.log(`[SMOKE-TP] insuficiente: status=${out.status}`)
    expect(out.status).toBe("blocked_manual")
    expect(gw.genCalls).toBe(0)
  })

  it("sem allowPaid (background) ⇒ blocked_cost_confirmation, nenhum job", async () => {
    __resetSingleFlight()
    const gw = new MemGateway(works(12))
    const out = await ensureTasteProfile({ gateway: gw, jobStore: store, allowPaid: false })
    console.log(`[SMOKE-TP] background: status=${out.status} est=${out.status === "blocked_cost_confirmation" ? out.estimatedUsd : "-"}`)
    expect(out.status).toBe("blocked_cost_confirmation")
    expect(gw.genCalls).toBe(0)
  })

  it("autorizado ⇒ job durável GLOBAL (work_id null) succeeded, payload mínimo", async () => {
    __resetSingleFlight()
    const gw = new MemGateway(works(12))
    const out = await ensureTasteProfile({ gateway: gw, jobStore: store, allowPaid: true })
    expect(out.status).toBe("succeeded")
    const { data } = await sb
      .from("work_processing_jobs")
      .select("work_id, status, cost_estimate_usd, cost_actual_usd, payload, dedup_key")
      .eq("action", "ensure_taste_profile")
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as Record<string, unknown> | null
    console.log(`[SMOKE-TP] durável: work_id=${row?.work_id} status=${row?.status} est=${row?.cost_estimate_usd} actual=${row?.cost_actual_usd} payload=${JSON.stringify(row?.payload)}`)
    expect(row?.work_id).toBeNull()
    expect(row?.status).toBe("succeeded")
    expect(Object.keys((row?.payload as object) ?? {}).sort()).toEqual(["inputHash", "model", "n", "promptVersion"])
    expect(String(row?.dedup_key)).not.toContain("-w0") // sem ids de obra
    expect(Number(row?.cost_actual_usd)).toBeGreaterThan(0)
  })

  it("duas concorrentes (mesmo hash) ⇒ 1 geração, 1 job", async () => {
    __resetSingleFlight()
    const gw = new MemGateway(works(13))
    const opts = { gateway: gw, jobStore: store, allowPaid: true }
    const [a, b] = await Promise.all([ensureTasteProfile(opts), ensureTasteProfile(opts)])
    const { count } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("action", "ensure_taste_profile")
      .gte("created_at", startedAt)
      .like("dedup_key", "ensure_taste_profile:%")
    console.log(`[SMOKE-TP] concorrente: a=${a.status} b=${b.status} genCalls=${gw.genCalls} jobs(total run)=${count}`)
    expect(gw.genCalls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
  })
})
