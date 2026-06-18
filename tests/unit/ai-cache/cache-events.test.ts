import { describe, it, expect } from "vitest"
import {
  aggregateCacheEvents,
  aggregateCacheEventGroup,
  aiCacheEventSchema,
  buildCacheEventRecord,
  toCacheEventRow,
  type AiCacheEventRecord,
  type RawCacheEventInput,
} from "@/lib/ai-cache/cache-events"
import {
  isCacheEventBypass,
  isCacheEventHit,
  isCacheEventMiss,
} from "@/lib/ai-cache/types"

function rec(partial: Partial<AiCacheEventRecord>): AiCacheEventRecord {
  return {
    createdAt: "2026-06-18T00:00:00.000Z",
    operation: "ai_evaluation",
    cacheLayer: "resolution",
    cacheStatus: "miss_not_found",
    isResolution: true,
    lookupLatencyMs: null,
    ...partial,
  }
}

describe("cache event status helpers (§25.2)", () => {
  it("classifica hit / miss / bypass corretamente", () => {
    expect(isCacheEventHit("hit_memory")).toBe(true)
    expect(isCacheEventHit("hit_persistent")).toBe(true)
    expect(isCacheEventHit("miss_not_found")).toBe(false)
    expect(isCacheEventMiss("miss_expired")).toBe(true)
    expect(isCacheEventMiss("hit_memory")).toBe(false)
    expect(isCacheEventBypass("bypass_manual")).toBe(true)
    expect(isCacheEventBypass("bypass_experiment")).toBe(true)
    expect(isCacheEventBypass("miss_not_found")).toBe(false)
  })
})

describe("aiCacheEventSchema (§25.2 — Zod inválido)", () => {
  it("aceita um evento válido", () => {
    const r = aiCacheEventSchema.safeParse({
      operation: "ai_evaluation",
      cacheLayer: "resolution",
      cacheStatus: "hit_memory",
    })
    expect(r.success).toBe(true)
  })

  it("rejeita status fora do enum", () => {
    const r = aiCacheEventSchema.safeParse({
      operation: "ai_evaluation",
      cacheLayer: "resolution",
      cacheStatus: "totally_made_up",
    })
    expect(r.success).toBe(false)
  })

  it("rejeita operation vazia e latência negativa", () => {
    expect(aiCacheEventSchema.safeParse({ operation: "", cacheLayer: "memory", cacheStatus: "miss_not_found" }).success).toBe(false)
    expect(
      aiCacheEventSchema.safeParse({ operation: "x", cacheLayer: "memory", cacheStatus: "miss_not_found", lookupLatencyMs: -1 }).success,
    ).toBe(false)
  })
})

describe("toCacheEventRow (§25.2)", () => {
  it("mapeia camelCase → snake_case com defaults", () => {
    const row = toCacheEventRow({
      operation: "ai_evaluation",
      cacheLayer: "resolution",
      cacheStatus: "hit_persistent",
      inputHash: "abc",
    })
    expect(row.operation).toBe("ai_evaluation")
    expect(row.cache_layer).toBe("resolution")
    expect(row.cache_status).toBe("hit_persistent")
    expect(row.is_resolution).toBe(true) // default
    expect(row.workload_type).toBe("unknown") // default
    expect(row.input_hash).toBe("abc")
    expect(row.metadata).toEqual({})
  })
})

describe("buildCacheEventRecord (§25.2 — valor corrompido)", () => {
  it("coage status/layer desconhecidos pra unknown/resolution (não quebra)", () => {
    const raw: RawCacheEventInput = {
      created_at: "2026-06-18T00:00:00.000Z",
      operation: "ai_evaluation",
      cache_layer: "garbage",
      cache_status: "garbage",
      is_resolution: null,
      lookup_latency_ms: null,
    }
    const r = buildCacheEventRecord(raw)
    expect(r.cacheStatus).toBe("unknown")
    expect(r.cacheLayer).toBe("resolution")
    expect(r.isResolution).toBe(true) // null → default true
  })
})

describe("aggregateCacheEvents (§25.2 / §9)", () => {
  it("conta hits/misses/bypass e calcula hitRate só sobre resoluções", () => {
    const m = aggregateCacheEventGroup("ai_evaluation", [
      rec({ cacheStatus: "hit_memory" }),
      rec({ cacheStatus: "hit_persistent" }),
      rec({ cacheStatus: "miss_not_found" }),
      rec({ cacheStatus: "bypass_manual" }),
      rec({ cacheStatus: "cache_error" }),
    ])
    expect(m.hits).toBe(2)
    expect(m.misses).toBe(1)
    expect(m.bypasses).toBe(1)
    expect(m.errors).toBe(1)
    expect(m.hitRate).toBeCloseTo(2 / 3) // hits / (hits+misses) — bypass/error fora
    expect(m.providerCallsAvoided).toBe(2)
    expect(m.layerHits.memory).toBe(1)
    expect(m.layerHits.persistent).toBe(1)
  })

  it("eventos intermediários (is_resolution=false) NÃO entram na taxa", () => {
    const m = aggregateCacheEventGroup("ai_evaluation", [
      rec({ cacheLayer: "memory", cacheStatus: "miss_not_found", isResolution: false }),
      rec({ cacheLayer: "resolution", cacheStatus: "hit_persistent", isResolution: true }),
    ])
    expect(m.lookups).toBe(1)
    expect(m.hits).toBe(1)
    expect(m.misses).toBe(0)
    expect(m.hitRate).toBe(1)
  })

  it("hitRate é null quando não há hit/miss resolvidos", () => {
    const m = aggregateCacheEventGroup("x", [rec({ cacheStatus: "bypass_experiment" })])
    expect(m.hitRate).toBeNull()
    expect(m.bypasses).toBe(1)
  })

  it("período vazio → lista vazia", () => {
    expect(aggregateCacheEvents([])).toEqual([])
  })

  it("agrupa por operação e ordena por lookups desc", () => {
    const out = aggregateCacheEvents([
      rec({ operation: "a", cacheStatus: "miss_not_found" }),
      rec({ operation: "b", cacheStatus: "hit_memory" }),
      rec({ operation: "b", cacheStatus: "hit_memory" }),
    ])
    expect(out[0]!.operation).toBe("b")
    expect(out[0]!.lookups).toBe(2)
    expect(out[1]!.operation).toBe("a")
  })
})
