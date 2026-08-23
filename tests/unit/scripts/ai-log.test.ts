import { describe, it, expect } from "vitest"
import { createRequire } from "node:module"
import { PRICING_SNAPSHOT_TAG } from "@/lib/ai/pricing"

// O adaptador é CJS (consumido por scripts Node puros). Carregamos via require.
const require = createRequire(import.meta.url)
const { computeCostUsd, extractUsage, logAiCall, loggedCreate } = require("../../../scripts/lib/ai-log.js")

function fakeSupabase() {
  const inserts: Record<string, unknown>[] = []
  return {
    inserts,
    from() {
      return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null } } }
    },
  }
}

describe("scripts/ai-log adapter (§25.6)", () => {
  it("computeCostUsd usa a MESMA tabela de preços (pricing-data.json)", () => {
    const c = computeCostUsd("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 200_000 })
    expect(c.cost_input_usd).toBeCloseTo(3, 6)
    expect(c.cost_output_usd).toBeCloseTo(3, 6)
    // 🔴 DERIVADO, nunca copiado. Esta linha já foi `"static@2026-05-23"` escrito à mão e
    // reprovou no primeiro bump legítimo do snapshot — o teste afirmava a tag por um
    // critério (literal no teste) e o adaptador por outro (o JSON), que é a mesma doença
    // que o adaptador existe para evitar entre app e scripts.
    expect(c.pricing_source).toBe(PRICING_SNAPSHOT_TAG)
  })

  it("modelo desconhecido → custo 0 + unknown@<model>", () => {
    const c = computeCostUsd("modelo-x", { inputTokens: 1_000_000 })
    expect(c.cost_input_usd).toBe(0)
    expect(c.pricing_source).toBe("unknown@modelo-x")
  })

  it("extractUsage lê os tokens do message", () => {
    const u = extractUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } })
    expect(u).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheCreationTokens: 1 })
  })

  it("logAiCall registra operação, custo e workload (na metadata)", async () => {
    const sb = fakeSupabase()
    await logAiCall(sb, {
      operation: "tag_audit",
      model: "claude-sonnet-4-6",
      promptVersion: "v1",
      workloadType: "admin",
      usage: { inputTokens: 1_000_000 },
      latencyMs: 50,
      status: "success",
      metadata: { attempt: 0 },
    })
    const row = sb.inserts[0]!
    expect(row.operation).toBe("tag_audit")
    expect(row.model_name).toBe("claude-sonnet-4-6")
    expect(row.cost_input_usd).toBeCloseTo(3, 6)
    expect(row.status).toBe("success")
    expect((row.metadata as Record<string, unknown>).workload_type).toBe("admin")
    expect((row.metadata as Record<string, unknown>).attempt).toBe(0)
  })

  it("loggedCreate chama o provider UMA vez, loga sucesso e devolve o message", async () => {
    const sb = fakeSupabase()
    let calls = 0
    const client = {
      messages: {
        create: async () => {
          calls += 1
          return { model: "claude-sonnet-4-6", id: "msg_1", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
        },
      },
    }
    const msg = await loggedCreate(client, sb, { model: "claude-sonnet-4-6" }, { operation: "quality_backfill", workloadType: "backfill" })
    expect(calls).toBe(1)
    expect(msg.id).toBe("msg_1")
    expect(sb.inserts[0]!.operation).toBe("quality_backfill")
    expect(sb.inserts[0]!.input_tokens).toBe(100)
    expect((sb.inserts[0]!.metadata as Record<string, unknown>).workload_type).toBe("backfill")
  })

  it("loggedCreate loga erro e RELANÇA (não engole)", async () => {
    const sb = fakeSupabase()
    const client = { messages: { create: async () => { throw new Error("provider boom") } } }
    await expect(
      loggedCreate(client, sb, { model: "claude-sonnet-4-6" }, { operation: "tag_audit", workloadType: "admin" }),
    ).rejects.toThrow("provider boom")
    expect(sb.inserts[0]!.status).toBe("error")
    expect(sb.inserts[0]!.error_message).toBe("provider boom")
  })

  it("falha de log NÃO derruba (best-effort)", async () => {
    const throwingSb = { from() { return { insert: async () => { throw new Error("db down") } } } }
    await expect(
      logAiCall(throwingSb, { operation: "x", model: "claude-sonnet-4-6", usage: {}, status: "success" }),
    ).resolves.toBeUndefined()
  })

  it("a linha não carrega secret (sem api key/token no payload)", async () => {
    const sb = fakeSupabase()
    await logAiCall(sb, { operation: "x", model: "claude-sonnet-4-6", usage: {}, status: "success", metadata: { attempt: 1 } })
    const serialized = JSON.stringify(sb.inserts[0]).toLowerCase()
    expect(serialized).not.toContain("api_key")
    expect(serialized).not.toContain("apikey")
    expect(serialized).not.toContain("service_role")
  })
})
