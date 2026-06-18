import { describe, it, expect } from "vitest"
import {
  estimateStep,
  estimateStepUsd,
  estimateUsdFromTokens,
  decideCost,
  gateActionCost,
  COST_SAFETY_MULTIPLIER,
  DEFAULT_MICRO_THRESHOLD_USD,
} from "@/lib/orchestration/cost"
import { computeCostUsd, type UsageTokens } from "@/lib/ai/pricing"

const SONNET = "claude-sonnet-4-6"
const usage = (i: number, o: number, cr = 0, cw = 0): UsageTokens => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: cr,
  cacheCreationTokens: cw,
})

describe("endurecimento do custo", () => {
  it("1) estimador e custo real usam a MESMA tabela/unidades", () => {
    const u = usage(5000, 1000)
    const viaEstimate = estimateUsdFromTokens(SONNET, u)
    const b = computeCostUsd(SONNET, u)
    const manual = b.costInputUsd + b.costOutputUsd + b.costCacheReadUsd + b.costCacheCreationUsd
    expect(viaEstimate).toBeCloseTo(manual)
    expect(manual).toBeCloseTo((5000 / 1e6) * 3 + (1000 / 1e6) * 15)
  })

  it("2) zero cache ⇒ só input/output", () => {
    const b = computeCostUsd(SONNET, usage(5000, 1000, 0, 0))
    expect(b.costCacheReadUsd).toBe(0)
    expect(b.costCacheCreationUsd).toBe(0)
  })

  it("3) cache read precificado a cacheReadPerMTok", () => {
    const b = computeCostUsd(SONNET, usage(0, 0, 10000, 0))
    expect(b.costCacheReadUsd).toBeCloseTo((10000 / 1e6) * 0.3)
  })

  it("4) cache write precificado a cacheCreationPerMTok", () => {
    const b = computeCostUsd(SONNET, usage(0, 0, 0, 10000))
    expect(b.costCacheCreationUsd).toBeCloseTo((10000 / 1e6) * 3.75)
  })

  it("5) quantidade mínima de obras ⇒ estimativa finita e positiva", () => {
    const e = estimateStep("ensure_taste_profile", 1)
    expect(Number.isFinite(e.upperBoundUsd)).toBe(true)
    expect(e.upperBoundUsd).toBeGreaterThan(0)
  })

  it("6) quantidade máxima do perfil escala acima da mínima", () => {
    const lo = estimateStepUsd("ensure_taste_profile", 1)
    const hi = estimateStepUsd("ensure_taste_profile", 200)
    expect(hi).toBeGreaterThan(lo)
    expect(Number.isFinite(hi)).toBe(true)
  })

  it("7) usa o OUTPUT MÁXIMO (max_tokens) na base", () => {
    expect(estimateStep("ensure_taste_profile", 5).usage.outputTokens).toBe(6000)
    expect(estimateStep("generate_review_digest", 5).usage.outputTokens).toBe(2000)
  })

  it("8) upper bound = likely × margem de segurança", () => {
    const e = estimateStep("ensure_taste_profile", 50)
    expect(e.upperBoundUsd).toBeCloseTo(e.likelyUsd * COST_SAFETY_MULTIPLIER)
    expect(COST_SAFETY_MULTIPLIER).toBeGreaterThan(1)
  })

  it("9) estimativa acima do teto ⇒ over_cap", () => {
    const r = gateActionCost("ensure_taste_profile", 200, { allowPaid: true, maxCostUsd: 0.05 })
    expect("blocked" in r && r.blocked).toBe("over_cap")
  })

  it("10) custo real entre o provável e o upper bound ⇒ gate (upper) é seguro", () => {
    const e = estimateStep("ensure_taste_profile", 12)
    // real ligeiramente mais pesado que o provável (per-obra subestimado), mas
    // ainda abaixo do upper bound do gate.
    const real = estimateUsdFromTokens(SONNET, usage(11000, 6000))
    expect(real).toBeGreaterThan(e.likelyUsd)
    expect(real).toBeLessThan(e.upperBoundUsd)
  })

  it("11) estimativa nunca negativa nem NaN", () => {
    for (const s of [0, 1, 12, 200]) {
      const e = estimateStep("ensure_taste_profile", s)
      expect(Number.isNaN(e.likelyUsd)).toBe(false)
      expect(e.likelyUsd).toBeGreaterThanOrEqual(0)
      expect(e.upperBoundUsd).toBeGreaterThanOrEqual(0)
    }
    // ação free (sem estimate) ⇒ 0, pricing conhecido
    const free = estimateStep("recalculate_scores", 1)
    expect(free.upperBoundUsd).toBe(0)
    expect(free.pricingKnown).toBe(true)
  })

  it("12) modelo/preço desconhecido BLOQUEIA (não assume custo zero)", () => {
    // sem o guard, computeCostUsd devolveria 0 (perigo):
    const raw = computeCostUsd("modelo-inexistente", usage(100000, 8000))
    expect(raw.costInputUsd).toBe(0)
    // com o guard:
    expect(estimateUsdFromTokens("modelo-inexistente", usage(100000, 8000))).toBe(Number.POSITIVE_INFINITY)
    // e Infinity nunca auto-executa, mesmo pré-autorizado:
    expect(decideCost({ estimatedUsd: Number.POSITIVE_INFINITY, microThresholdUsd: DEFAULT_MICRO_THRESHOLD_USD, allowPaid: true })).toBe("needs_confirmation")
    expect(decideCost({ estimatedUsd: NaN, microThresholdUsd: DEFAULT_MICRO_THRESHOLD_USD, allowPaid: true })).toBe("needs_confirmation")
  })
})
