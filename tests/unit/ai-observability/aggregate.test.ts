import { describe, it, expect } from "vitest"
import {
  aggregateGroup,
  aggregateOperationMetrics,
  buildAiCallRecord,
  compareImplementationPeriods,
  percentile,
  summarizeCacheMetrics,
  type AiCallRecord,
  type RawAiCallInput,
} from "@/lib/ai-observability/aggregate"

function rec(p: Partial<AiCallRecord>): AiCallRecord {
  return {
    createdAt: "2026-06-01T00:00:00Z",
    operation: "ai_evaluation",
    model: "claude-sonnet-4-6",
    promptVersion: "v19",
    status: "success",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    latencyMs: null,
    errorCategory: null,
    workload: "unknown",
    logicalRequestId: null,
    attempt: null,
    cacheStatus: null,
    imageStatus: null,
    ...p,
  }
}

describe("percentile", () => {
  it("nearest-rank p50/p95", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(xs, 50)).toBe(50)
    expect(percentile(xs, 95)).toBe(100)
    expect(percentile(xs, 0)).toBe(10)
    expect(percentile(xs, 100)).toBe(100)
  })
  it("vazio → null (ausência não vira zero)", () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([NaN, Infinity], 50)).toBeNull()
  })
})

describe("buildAiCallRecord (ponte histórica)", () => {
  const base: RawAiCallInput = {
    created_at: "2026-06-15T12:00:00Z",
    operation: "ai_evaluation",
    model_name: "claude-sonnet-4-6",
    prompt_version: "v19",
    status: "error",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_total_usd: "0",
    latency_ms: 1234,
    error_message: '400 {"error":{"message":"image.source.url: Unable to download image"}}',
    stop_reason: null,
    metadata: { attempt: 0, hasImage: true },
  }

  it("deriva error_category da mensagem em linha histórica", () => {
    const r = buildAiCallRecord(base)
    expect(r.errorCategory).toBe("provider_image_invalid_request")
    expect(r.workload).toBe("unknown") // sem sinal → unknown
    expect(r.attempt).toBe(0)
  })

  it("metadata.error_category explícito tem prioridade sobre a heurística", () => {
    const r = buildAiCallRecord({ ...base, metadata: { error_category: "provider_timeout" } })
    expect(r.errorCategory).toBe("provider_timeout")
  })

  it("status success → errorCategory null; numeric string vira número", () => {
    const r = buildAiCallRecord({ ...base, status: "success", cost_total_usd: "0.044", error_message: null })
    expect(r.errorCategory).toBeNull()
    expect(r.costUsd).toBeCloseTo(0.044)
  })
})

describe("aggregateGroup — solicitação lógica × tentativa", () => {
  it("conta tentativas e aproxima solicitações lógicas (sem ids)", () => {
    // 2 solicitações: uma com retry (attempt 0 e 1), outra simples (attempt 0).
    const records = [
      rec({ attempt: 0, status: "error", costUsd: 0 }),
      rec({ attempt: 1, status: "success", costUsd: 0.04 }),
      rec({ attempt: 0, status: "success", costUsd: 0.04 }),
    ]
    const m = aggregateGroup("ai_evaluation", records)
    expect(m.attempts).toBe(3)
    expect(m.successes).toBe(2)
    expect(m.failures).toBe(1)
    expect(m.logicalRequests).toBeNull() // nenhuma linha tem logical_request_id
    expect(m.logicalRequestsApprox).toBe(2) // duas linhas com attempt 0
    expect(m.attemptsPerLogicalRequest).toBeCloseTo(1.5)
  })

  it("usa logical_request_id exato quando todas as linhas têm", () => {
    const records = [
      rec({ logicalRequestId: "a", attempt: 0, status: "error" }),
      rec({ logicalRequestId: "a", attempt: 0, status: "success" }), // image fallback, mesmo id
      rec({ logicalRequestId: "b", attempt: 0, status: "success" }),
    ]
    const m = aggregateGroup("ai_evaluation", records)
    expect(m.logicalRequests).toBe(2)
    expect(m.attemptsPerLogicalRequest).toBeCloseTo(1.5)
  })

  it("custo por sucesso é null quando não há sucesso (ausência ≠ zero)", () => {
    const records = [rec({ status: "error", costUsd: 0, attempt: 0 })]
    const m = aggregateGroup("ai_evaluation", records)
    expect(m.costPerSuccess).toBeNull()
    expect(m.errorRate).toBe(1)
  })

  it("percentis de latência ignoram null; breakdowns por modelo/workload/erro", () => {
    const records = [
      rec({ latencyMs: 1000, model: "claude-sonnet-4-6", workload: "recurring" }),
      rec({ latencyMs: null, model: "claude-haiku-4-5-20251001", workload: "experiment" }),
      rec({ latencyMs: 3000, status: "error", errorCategory: "provider_overloaded", workload: "recurring" }),
      rec({ latencyMs: 9000, status: "error", errorCategory: "provider_image_invalid_request" }),
    ]
    const m = aggregateGroup("ai_evaluation", records)
    expect(m.latencyP50Ms).toBe(3000)
    expect(m.latencyMaxMs).toBe(9000)
    expect(m.byModel["claude-sonnet-4-6"]).toBe(3)
    expect(m.byWorkload.recurring).toBe(2)
    expect(m.errorsByCategory.provider_overloaded).toBe(1)
    expect(m.errorsByCategory.provider_image_invalid_request).toBe(1)
  })

  it("grupo vazio é seguro", () => {
    const m = aggregateGroup("x", [])
    expect(m.attempts).toBe(0)
    expect(m.errorRate).toBe(0)
    expect(m.logicalRequests).toBeNull()
    expect(m.costPerSuccess).toBeNull()
    expect(m.latencyP50Ms).toBeNull()
  })
})

describe("aggregateOperationMetrics", () => {
  it("agrupa por operação e ordena por custo desc", () => {
    const records = [
      rec({ operation: "review_summarizer", costUsd: 0.01 }),
      rec({ operation: "ai_evaluation", costUsd: 0.5 }),
      rec({ operation: "ai_evaluation", costUsd: 0.5 }),
    ]
    const out = aggregateOperationMetrics(records)
    expect(out.map((o) => o.operation)).toEqual(["ai_evaluation", "review_summarizer"])
    expect(out[0]!.costUsd).toBe(1)
  })
})

describe("summarizeCacheMetrics", () => {
  it("hitRate null quando não há eventos de cache observáveis", () => {
    const m = summarizeCacheMetrics([rec({}), rec({})])
    expect(m.hitRate).toBeNull()
    expect(m.providerCalls).toBe(2)
  })
  it("calcula hitRate quando há hits e misses registrados", () => {
    const m = summarizeCacheMetrics([
      rec({ cacheStatus: "memory" }),
      rec({ cacheStatus: "db" }),
      rec({ cacheStatus: "miss" }),
      rec({ cacheStatus: "bypass" }),
    ])
    expect(m.hits).toBe(2)
    expect(m.misses).toBe(1)
    expect(m.bypasses).toBe(1)
    expect(m.hitRate).toBeCloseTo(2 / 3)
    expect(m.providerCalls).toBe(2) // miss + bypass
  })
})

describe("compareImplementationPeriods (fix das capas)", () => {
  const cutoff = "2026-06-17T00:00:00Z"
  it("divide por corte temporal e sinaliza amostra insuficiente", () => {
    const before = Array.from({ length: 5 }, () =>
      rec({ createdAt: "2026-06-10T00:00:00Z", status: "error", errorCategory: "provider_image_invalid_request" }),
    )
    const after = [rec({ createdAt: "2026-06-17T10:00:00Z", status: "success" })]
    const cmp = compareImplementationPeriods("ai_evaluation", [...before, ...after], cutoff)
    expect(cmp.before?.attempts).toBe(5)
    expect(cmp.after?.attempts).toBe(1)
    expect(cmp.hasSufficientSample).toBe(false) // <20 de cada lado
  })

  it("lado vazio vira null", () => {
    const cmp = compareImplementationPeriods(
      "ai_evaluation",
      [rec({ createdAt: "2026-06-10T00:00:00Z" })],
      cutoff,
    )
    expect(cmp.before?.attempts).toBe(1)
    expect(cmp.after).toBeNull()
  })
})
