import { describe, it, expect } from "vitest"
import {
  estimateStepUsd,
  decideCost,
  DEFAULT_MICRO_THRESHOLD_USD,
} from "@/lib/orchestration/cost"

describe("estimateStepUsd", () => {
  it("ação free (sem estimate) ⇒ custo 0", () => {
    expect(estimateStepUsd("recalculate_scores")).toBe(0)
  })

  it("predict_interest (perfil pronto) é sub-cent (< micro-threshold)", () => {
    expect(estimateStepUsd("predict_interest_potential", 1)).toBeLessThan(DEFAULT_MICRO_THRESHOLD_USD)
  })

  it("ensure_taste_profile escala com N e fica metered (>> micro)", () => {
    const big = estimateStepUsd("ensure_taste_profile", 200)
    expect(big).toBeGreaterThan(0.1)
    expect(big).toBeGreaterThan(estimateStepUsd("ensure_taste_profile", 1))
  })
})

describe("decideCost (D3: cascata + micro-threshold)", () => {
  const micro = DEFAULT_MICRO_THRESHOLD_USD

  it("≤ micro ⇒ auto (silencioso)", () => {
    expect(decideCost({ estimatedUsd: 0.005, microThresholdUsd: micro, allowPaid: false })).toBe("auto")
    expect(decideCost({ estimatedUsd: micro, microThresholdUsd: micro, allowPaid: false })).toBe("auto")
  })

  it("> micro e não autorizado ⇒ needs_confirmation", () => {
    expect(decideCost({ estimatedUsd: 0.21, microThresholdUsd: micro, allowPaid: false })).toBe("needs_confirmation")
  })

  it("> micro mas autorizado e dentro do teto ⇒ auto", () => {
    expect(decideCost({ estimatedUsd: 0.21, microThresholdUsd: micro, allowPaid: true })).toBe("auto")
    expect(decideCost({ estimatedUsd: 0.21, microThresholdUsd: micro, allowPaid: true, maxCostUsd: 0.5 })).toBe("auto")
  })

  it("autorizado mas acima do teto ⇒ blocked_over_cap", () => {
    expect(decideCost({ estimatedUsd: 0.21, microThresholdUsd: micro, allowPaid: true, maxCostUsd: 0.05 })).toBe("blocked_over_cap")
  })
})
