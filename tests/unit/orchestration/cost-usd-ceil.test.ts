import { describe, it, expect } from "vitest"
import { ceilUsdToCents, decideCost } from "@/lib/orchestration/cost"

// Etapa 2C.1 — teto sugerido NUNCA pode ficar abaixo do upper bound real.
// ceilUsdToCents arredonda p/ CIMA ao centavo, tolerando ruído de float.

describe("ceilUsdToCents — teto arredondado p/ cima ao centavo", () => {
  it("1) 1.575 → 1.58", () => expect(ceilUsdToCents(1.575)).toBe(1.58))
  it("2) 1.57 → 1.57 (já em centavos)", () => expect(ceilUsdToCents(1.57)).toBe(1.57))
  it("3) ruído 1.5700000000000003 → 1.57", () => expect(ceilUsdToCents(1.5700000000000003)).toBe(1.57))
  it("4) 0.769 → 0.77", () => expect(ceilUsdToCents(0.769)).toBe(0.77))
  it("5) 0.001 → 0.01", () => expect(ceilUsdToCents(0.001)).toBe(0.01))
  it("6) 0 → 0 (sem -0)", () => {
    const r = ceilUsdToCents(0)
    expect(r).toBe(0)
    expect(Object.is(r, -0)).toBe(false)
  })
  it("7) negativo rejeitado", () => expect(() => ceilUsdToCents(-0.01)).toThrow(RangeError))
  it("8) NaN rejeitado", () => expect(() => ceilUsdToCents(NaN)).toThrow(RangeError))
  it("9) Infinity rejeitado", () => expect(() => ceilUsdToCents(Infinity)).toThrow(RangeError))

  it("extra) tabela da spec", () => {
    expect(ceilUsdToCents(0.01)).toBe(0.01)
    expect(ceilUsdToCents(0.011)).toBe(0.02)
    expect(ceilUsdToCents(1.57)).toBe(1.57)
    expect(ceilUsdToCents(11.371)).toBe(11.38)
  })

  it("10) teto sugerido NUNCA menor que o upper real (amostra ampla)", () => {
    for (let i = 0; i <= 2000; i++) {
      const upper = i * 0.0007893 // varre frações sub-centavo
      const ceil = ceilUsdToCents(upper)
      // tolera só o ruído de representação (≤ 1e-6 USD), coerente com round6
      expect(ceil).toBeGreaterThanOrEqual(upper - 1e-6)
    }
  })
})

describe("gate (decideCost) — boundary p/ upper 1.575", () => {
  const gate = (maxCostUsd: number) =>
    decideCost({ estimatedUsd: 1.575, microThresholdUsd: 0.02, allowPaid: true, maxCostUsd })
  it("11) 1.57 bloqueia (over_cap)", () => expect(gate(1.57)).toBe("blocked_over_cap"))
  it("11b) 1.574 bloqueia", () => expect(gate(1.574)).toBe("blocked_over_cap"))
  it("12a) 1.575 aceita (precisão atual)", () => expect(gate(1.575)).toBe("auto"))
  it("12b) 1.58 aceita", () => expect(gate(1.58)).toBe("auto"))
  it("12c) 1.60 aceita", () => expect(gate(1.6)).toBe("auto"))
  it("13) o teto sugerido (ceil de 1.575 = 1.58) é aceito pelo gate", () => {
    expect(gate(ceilUsdToCents(1.575))).toBe("auto")
  })
})
