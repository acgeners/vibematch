/**
 * SMOKE da integração Potencial de Interesse × fila durável (passo 4).
 *
 * Gratuito: NÃO chama LLM (predictor no-op) e NÃO altera dados funcionais — o
 * gateway é EM MEMÓRIA (synopsis_quality_predictions nunca é escrito). Só
 * cria/apaga linhas próprias em work_processing_jobs (work_id real, via FK) com
 * SupabaseJobStore real. Limpa cirurgicamente no afterAll.
 *
 * Habilite com:
 *   RUN_SMOKE=1 npx vitest run tests/smoke/synopsis-interest-integration.smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { SupabaseJobStore } from "@/lib/orchestration/jobs"
import {
  ensurePredictInterest,
  type InterestGateway,
  type InterestWorkData,
  type StoredPrediction,
} from "@/lib/orchestration/integrations/synopsis-interest"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { EnsureTasteProfileOutcome } from "@/lib/orchestration/integrations/taste-profile"
import type { TasteProfilePayload, TasteProfileRow } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const SMOKE = process.env.RUN_SMOKE === "1"
if (SMOKE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const ENABLED = SMOKE && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

const EMPTY: TasteProfilePayload = { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
const ROW: TasteProfileRow = { id: "p", version: 6, is_current: true, is_stub: false, n_works_used: 12, input_hash: "h", model_name: MODEL, prompt_version: "v1", profile: EMPTY, raw_response: null, created_at: new Date().toISOString() }
const WORK: InterestWorkData = { title: "Smoke Title", tags: ["x", "y"], canonicalSynopsis: "sinopse canonica longa o suficiente para o smoke", rawSynopsis: null }

class MemGateway implements InterestGateway {
  stored: StoredPrediction | null = null
  predictCalls = 0
  constructor(stored: StoredPrediction | null = null) {
    this.stored = stored
  }
  async loadWork() {
    return WORK
  }
  async loadCurrentPrediction() {
    return this.stored
  }
  async consolidationJobStatus() {
    return null
  }
  async persistPrediction(args: Parameters<InterestGateway["persistPrediction"]>[0]) {
    this.stored = { predictedQuality: args.predictedQuality, inputSignature: args.inputSignature, tasteProfileHash: computeProfileSignature(args.profile.profile), stale: false }
  }
}
const profileFresh = async (): Promise<EnsureTasteProfileOutcome> => ({ status: "fresh", profile: ROW })
const profileBlocked = async (): Promise<EnsureTasteProfileOutcome> => ({ status: "blocked_cost_confirmation", reason: "threshold", estimatedUsd: 0.58, likelyUsd: 0.39, ratedWorksCount: 192 })
const noopPredict = (gw: MemGateway) => async () => {
  gw.predictCalls++
  return { predictedQuality: "♥♥♥" as const, justification: "j", confidence: 0.6, modelName: MODEL, promptVersion: PROMPT_VERSION, apiCallId: null, usageUsd: 0.012 }
}
describe.skipIf(!ENABLED)("SMOKE — Potencial de Interesse × fila durável", () => {
  let sb: ReturnType<typeof createAdminClient>
  let store: SupabaseJobStore
  let workId: string
  let startedAt: string

  beforeAll(async () => {
    sb = createAdminClient()
    store = new SupabaseJobStore(sb)
    startedAt = new Date(Date.now() - 1000).toISOString()
    const { data } = await sb.from("works").select("id").limit(1).maybeSingle()
    workId = (data?.id as string) ?? ""
    console.log(`[SMOKE-PI] work_id real (não escrito) = ${workId}`)
  })

  afterAll(async () => {
    const { count } = await sb.from("work_processing_jobs").delete({ count: "exact" }).eq("action", "predict_interest_potential").gte("created_at", startedAt)
    const { count: remaining } = await sb.from("work_processing_jobs").select("*", { count: "exact", head: true }).eq("action", "predict_interest_potential").gte("created_at", startedAt)
    console.log(`[SMOKE-PI] cleanup: removidas ${count ?? "?"}; residual = ${remaining ?? "?"}`)
    expect(remaining ?? 0).toBe(0)
  })

  it("perfil bloqueado (cascata) ⇒ blocked_cost_confirmation, nenhum job", async () => {
    const gw = new MemGateway()
    const out = await ensurePredictInterest(workId, { gateway: gw, jobStore: store, ensureProfile: profileBlocked, predict: noopPredict(gw), allowPaid: false })
    console.log(`[SMOKE-PI] cascata: status=${out.status} est=${out.status === "blocked_cost_confirmation" ? out.estimatedUsd.toFixed(4) : "-"}`)
    expect(out.status).toBe("blocked_cost_confirmation")
    expect(gw.predictCalls).toBe(0)
  })

  it("perfil fresh + previsão ausente ⇒ job durável succeeded (payload mínimo, work_id real)", async () => {
    __resetSingleFlight()
    const gw = new MemGateway(null)
    const out = await ensurePredictInterest(workId, { gateway: gw, jobStore: store, ensureProfile: profileFresh, predict: noopPredict(gw), allowPaid: true })
    expect(out.status).toBe("succeeded")
    const { data } = await sb
      .from("work_processing_jobs")
      .select("work_id, status, cost_estimate_usd, cost_actual_usd, payload, dedup_key")
      .eq("action", "predict_interest_potential")
      .eq("work_id", workId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as Record<string, unknown> | null
    console.log(`[SMOKE-PI] durável: work_id=${row?.work_id} status=${row?.status} est=${row?.cost_estimate_usd} actual=${row?.cost_actual_usd} payload=${JSON.stringify(row?.payload)}`)
    expect(row?.work_id).toBe(workId)
    expect(row?.status).toBe("succeeded")
    expect(Object.keys((row?.payload as object) ?? {}).sort()).toEqual(["inputSignature", "model", "nTags", "profileSignature", "promptVersion", "schemaVersion", "synopsisSource", "workId"])
    expect(JSON.stringify(row?.payload)).not.toContain("suficiente") // sem texto da sinopse
  })

  it("duas concorrentes (mesma assinatura) ⇒ 1 LLM, 1 job", async () => {
    __resetSingleFlight()
    const gw = new MemGateway(null)
    const opts = { gateway: gw, jobStore: store, ensureProfile: profileFresh, predict: noopPredict(gw), allowPaid: true }
    const [a, b] = await Promise.all([ensurePredictInterest(workId, opts), ensurePredictInterest(workId, opts)])
    console.log(`[SMOKE-PI] concorrente: a=${a.status} b=${b.status} predictCalls=${gw.predictCalls}`)
    expect(gw.predictCalls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
  })

  it("compatibilidade legada: SupabaseInterestGateway lê linha legada com input_signature=null (READ-ONLY)", async () => {
    const { SupabaseInterestGateway, __resetInputSignatureProbe } = await import("@/lib/orchestration/integrations/synopsis-interest")
    __resetInputSignatureProbe()
    // pega uma previsão real existente (das 1.026 legadas)
    const { data } = await sb.from("synopsis_quality_predictions").select("work_id, prompt_version, input_signature").limit(1).maybeSingle()
    if (!data) {
      console.log("[SMOKE-PI] legado: nenhuma previsão existente — pulado")
      return
    }
    const row = data as { work_id: string; prompt_version: string; input_signature: string | null }
    const gw = new SupabaseInterestGateway(sb)
    const stored = await gw.loadCurrentPrediction(row.work_id, row.prompt_version)
    console.log(`[SMOKE-PI] legado: input_signature(db)=${row.input_signature === null ? "null" : "set"} → gateway.inputSignature=${stored?.inputSignature === null ? "null" : "set"} (coluna 111 lida sem erro)`)
    expect(stored).not.toBeNull()
    // a coluna existe (migration 111 aplicada) e a linha legada vem com null ⇒ dual-read legado.
    expect(stored?.inputSignature).toBe(row.input_signature ?? null)
  })

  it("dry-run do lote sobre previsões reais (READ-ONLY, sem job, sem provider)", async () => {
    const { SupabaseInterestGateway, planInterestBatch } = await import("@/lib/orchestration/integrations/synopsis-interest")
    const { data } = await sb.from("synopsis_quality_predictions").select("work_id").limit(5)
    const ids = (data ?? []).map((r) => (r as { work_id: string }).work_id)
    if (ids.length === 0) {
      console.log("[SMOKE-PI] dry-run: sem previsões — pulado")
      return
    }
    const plan = await planInterestBatch(ids, { gateway: new SupabaseInterestGateway(sb), profileSignature: "qualquer", profileNeedsGeneration: false, profileScale: 192 })
    console.log(`[SMOKE-PI] dry-run lote: total=${plan.total} fresh=${plan.fresh} stale=${plan.stale} absent=${plan.absent} upper=$${plan.upperBoundUsd.toFixed(4)}`)
    expect(plan.total).toBe(ids.length)
    expect(plan.fresh + plan.stale + plan.absent).toBe(ids.length)
  })
})
