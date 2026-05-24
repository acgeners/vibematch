import { describe, it, expect } from "vitest"
import {
  computeCostUsd,
  MODEL_PRICING,
  PRICING_SNAPSHOT_TAG,
} from "@/lib/ai/pricing"

describe("computeCostUsd", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 200_000,
    cacheCreationTokens: 100_000,
  }

  it("usa a tag do snapshot quando modelo é conhecido", () => {
    const result = computeCostUsd("claude-sonnet-4-6", usage)
    expect(result.pricingSource).toBe(PRICING_SNAPSHOT_TAG)
  })

  it("retorna pricingSource unknown@<model> quando modelo é desconhecido", () => {
    const result = computeCostUsd("modelo-inexistente", usage)
    expect(result.pricingSource).toBe("unknown@modelo-inexistente")
    expect(result.costInputUsd).toBe(0)
    expect(result.costOutputUsd).toBe(0)
  })

  it("multiplica linearmente os tokens pelo preço por 1M", () => {
    const fakeModel = "test-fake-model"
    const original = MODEL_PRICING[fakeModel]
    MODEL_PRICING[fakeModel] = {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheCreationPerMTok: 3.75,
    }
    try {
      const result = computeCostUsd(fakeModel, {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: 500_000,
        cacheCreationTokens: 50_000,
      })
      // 1M * 3 / 1M = 3
      expect(result.costInputUsd).toBeCloseTo(3, 6)
      // 200k * 15 / 1M = 3
      expect(result.costOutputUsd).toBeCloseTo(3, 6)
      // 500k * 0.3 / 1M = 0.15
      expect(result.costCacheReadUsd).toBeCloseTo(0.15, 6)
      // 50k * 3.75 / 1M = 0.1875
      expect(result.costCacheCreationUsd).toBeCloseTo(0.1875, 6)
    } finally {
      if (original) MODEL_PRICING[fakeModel] = original
      else delete MODEL_PRICING[fakeModel]
    }
  })

  it("zero tokens → zero custo em todos os componentes", () => {
    const result = computeCostUsd("claude-sonnet-4-6", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
    expect(result.costInputUsd).toBe(0)
    expect(result.costOutputUsd).toBe(0)
    expect(result.costCacheReadUsd).toBe(0)
    expect(result.costCacheCreationUsd).toBe(0)
  })
})
