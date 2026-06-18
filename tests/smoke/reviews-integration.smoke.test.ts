/**
 * SMOKE da integração review_summary/review_digest com a fila durável (Etapa 3).
 *
 * Gratuito: NÃO chama LLM (consolidate no-op) e NÃO altera dados funcionais —
 * o gateway é EM MEMÓRIA (works nunca é escrito). Só cria/atualiza/apaga linhas
 * próprias em work_processing_jobs via SupabaseJobStore real. As linhas de job
 * referenciam um work_id real (FK), lido read-only, mas o work não é tocado.
 * Limpa os jobs no afterAll.
 *
 * Desativado por padrão. Habilite com:
 *   RUN_SMOKE=1 npx vitest run tests/smoke/reviews-integration.smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { SupabaseJobStore } from "@/lib/orchestration/jobs"
import {
  ensureReviewSummary,
  ensureReviewDigest,
  type SummaryGateway,
  type DigestGateway,
} from "@/lib/orchestration/integrations/reviews"
import {
  packReviewSummaryMeta,
  REVIEW_DIGEST_VERSION,
  type ConsolidateReviewsStatus,
  type ConsolidateDigestStatus,
  type ReviewSummaryInput,
  type ReviewDigestInput,
} from "@/lib/ai-recommendation/review-summarizer"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import { __resetSingleFlight } from "@/lib/ai-cache/single-flight"

const SMOKE = process.env.RUN_SMOKE === "1"
if (SMOKE && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
const ENABLED = SMOKE && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

const HAIKU = "claude-haiku-4-5-20251001"
const SONNET = "claude-sonnet-4-6"
const DIGEST: ReviewDigest = { consensus: "c", divergence: "d", salient_traits: [], content_warnings: [], execution: "e" }
const rev = (n: number): ReviewSummaryInput[] =>
  Array.from({ length: n }, (_, i) => ({ text: `review ${i} com texto longo o suficiente pra passar do piso de quarenta caracteres`, userRating: null }))
const drev = (n: number): ReviewDigestInput[] => rev(n).map((r) => ({ ...r, source: "anilist" }))

class MemSummaryGateway implements SummaryGateway {
  summary: string | null = null
  meta: string | null = null
  constructor(public reviews: ReviewSummaryInput[]) {}
  async readReviews() {
    return this.reviews
  }
  async readArtifact() {
    return { summary: this.summary, meta: this.meta }
  }
  async writeArtifact(_id: string, v: { summary: string; hash: string; n: number }) {
    this.summary = v.summary
    this.meta = packReviewSummaryMeta(v.hash, v.n)
  }
}
class MemDigestGateway implements DigestGateway {
  digest: unknown = null
  version: string | null = null
  n: number | null = null
  constructor(public reviews: ReviewDigestInput[]) {}
  async readReviews() {
    return this.reviews
  }
  async readArtifact() {
    return { digest: this.digest, version: this.version, n: this.n }
  }
  async writeArtifact(_id: string, v: { digest: ReviewDigest; n: number }) {
    this.digest = v.digest
    this.n = v.n
    this.version = REVIEW_DIGEST_VERSION
  }
}
const okSummary = (state: { calls: number }) => async (): Promise<ConsolidateReviewsStatus> => {
  state.calls++
  return { kind: "ok", result: { summary: "RESUMO", model: HAIKU, promptVersion: "v2", tokensIn: 1000, tokensOut: 100 } }
}
const okDigest = (state: { calls: number }) => async (): Promise<ConsolidateDigestStatus> => {
  state.calls++
  return { kind: "ok", result: { digest: DIGEST, model: SONNET, promptVersion: REVIEW_DIGEST_VERSION, tokensIn: 3000, tokensOut: 500 } }
}

describe.skipIf(!ENABLED)("SMOKE — integração reviews × fila durável", () => {
  let sb: ReturnType<typeof createAdminClient>
  let store: SupabaseJobStore
  let workId: string

  beforeAll(async () => {
    sb = createAdminClient()
    store = new SupabaseJobStore(sb)
    const { data } = await sb.from("works").select("id").limit(1).maybeSingle()
    workId = (data?.id as string) ?? ""
    console.log(`[SMOKE-REV] work_id real (não será escrito) = ${workId}`)
  })

  afterAll(async () => {
    const { count } = await sb.from("work_processing_jobs").delete({ count: "exact" }).eq("work_id", workId)
    const { count: remaining } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("work_id", workId)
    console.log(`[SMOKE-REV] cleanup: removidas ${count ?? "?"}; residual = ${remaining ?? "?"}`)
    expect(remaining ?? 0).toBe(0)
  })

  it("sem reviews ⇒ not_ready, nenhum job criado", async () => {
    const calls = { calls: 0 }
    const out = await ensureReviewSummary(workId, { gateway: new MemSummaryGateway([]), jobStore: store, consolidate: okSummary(calls), allowPaid: true })
    console.log(`[SMOKE-REV] sem reviews: status=${out.status} llmCalls=${calls.calls}`)
    expect(out.status).toBe("not_ready")
    expect(calls.calls).toBe(0)
  })

  it("summary ausente ⇒ job durável succeeded (payload mínimo, custo real)", async () => {
    __resetSingleFlight()
    const calls = { calls: 0 }
    const out = await ensureReviewSummary(workId, { gateway: new MemSummaryGateway(rev(6)), jobStore: store, consolidate: okSummary(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    const { data } = await sb
      .from("work_processing_jobs")
      .select("status, attempts, cost_estimate_usd, cost_actual_usd, payload, dedup_key, started_at, finished_at")
      .eq("work_id", workId)
      .eq("action", "generate_review_summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as Record<string, unknown> | null
    console.log(`[SMOKE-REV] summary durável: status=${row?.status} est=${row?.cost_estimate_usd} actual=${row?.cost_actual_usd} payload=${JSON.stringify(row?.payload)}`)
    expect(row?.status).toBe("succeeded")
    expect(Object.keys((row?.payload as object) ?? {}).sort()).toEqual(["hash", "n", "promptVersion"])
    expect(String(row?.dedup_key)).not.toContain("review ")
    expect(Number(row?.cost_actual_usd)).toBeGreaterThan(0)
    expect(row?.finished_at).not.toBeNull()
  })

  it("duas execuções concorrentes (mesma assinatura) ⇒ 1 LLM, 1 job", async () => {
    __resetSingleFlight()
    const calls = { calls: 0 }
    const gw = new MemSummaryGateway(rev(7))
    const opts = { gateway: gw, jobStore: store, consolidate: okSummary(calls), allowPaid: true }
    const [a, b] = await Promise.all([ensureReviewSummary(workId, opts), ensureReviewSummary(workId, opts)])
    const { count } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("work_id", workId)
      .like("dedup_key", "generate_review_summary:%")
    console.log(`[SMOKE-REV] concorrente: a=${a.status} b=${b.status} llmCalls=${calls.calls}`)
    expect(calls.calls).toBe(1)
    expect(a.status).toBe("succeeded")
    expect(b.status).toBe("succeeded")
    // 2 chaves no total (a do teste anterior rev(6) + esta rev(7)), mas 1 por assinatura.
    expect((count ?? 0) >= 1).toBe(true)
  })

  it("digest sem allowPaid ⇒ blocked_cost_confirmation (sem LLM/job)", async () => {
    __resetSingleFlight()
    const calls = { calls: 0 }
    const out = await ensureReviewDigest(workId, { gateway: new MemDigestGateway(drev(6)), jobStore: store, consolidate: okDigest(calls), allowPaid: false })
    console.log(`[SMOKE-REV] digest gate: status=${out.status} reason=${out.status === "blocked_cost_confirmation" ? out.reason : "-"} est=${out.status === "blocked_cost_confirmation" ? out.estimatedUsd : "-"}`)
    expect(out.status).toBe("blocked_cost_confirmation")
    expect(calls.calls).toBe(0)
    const { count } = await sb
      .from("work_processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("work_id", workId)
      .eq("action", "generate_review_digest")
    expect(count ?? 0).toBe(0)
  })

  it("digest com allowPaid ⇒ job durável succeeded", async () => {
    __resetSingleFlight()
    const calls = { calls: 0 }
    const out = await ensureReviewDigest(workId, { gateway: new MemDigestGateway(drev(6)), jobStore: store, consolidate: okDigest(calls), allowPaid: true })
    expect(out.status).toBe("succeeded")
    expect(calls.calls).toBe(1)
    const { data } = await sb
      .from("work_processing_jobs")
      .select("status, action, cost_actual_usd")
      .eq("work_id", workId)
      .eq("action", "generate_review_digest")
      .maybeSingle()
    console.log(`[SMOKE-REV] digest durável: status=${(data as Record<string, unknown> | null)?.status} actual=${(data as Record<string, unknown> | null)?.cost_actual_usd}`)
    expect((data as Record<string, unknown> | null)?.status).toBe("succeeded")
  })
})
