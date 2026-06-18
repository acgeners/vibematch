import { describe, it, expect } from "vitest"
import { classifyWorkload } from "@/lib/ai-observability/workload"

describe("classifyWorkload", () => {
  it("metadata.workload_type explícito tem prioridade máxima", () => {
    expect(
      classifyWorkload({ operation: "ai_evaluation", metadata: { workload_type: "backfill" } }),
    ).toBe("backfill")
  })

  it("workload_type inválido é ignorado (cai pro restante)", () => {
    expect(
      classifyWorkload({ operation: "ai_evaluation", metadata: { workload_type: "lixo" } }),
    ).toBe("unknown")
  })

  it("backfill por flag", () => {
    expect(classifyWorkload({ operation: "synopsis_quality_predict", metadata: { backfill: true } })).toBe(
      "backfill",
    )
  })

  it("override (Reavaliar com…/compare-models) → experiment (camelCase e snake_case)", () => {
    expect(classifyWorkload({ operation: "ai_evaluation", metadata: { isOverride: true } })).toBe(
      "experiment",
    )
    expect(classifyWorkload({ operation: "ai_evaluation", metadata: { is_override: true } })).toBe(
      "experiment",
    )
  })

  it("operação inerentemente admin → admin", () => {
    expect(classifyWorkload({ operation: "calibration_audit" })).toBe("admin")
    expect(classifyWorkload({ operation: "tag_clustering" })).toBe("admin")
    expect(classifyWorkload({ operation: "calibration_bias", metadata: null })).toBe("admin")
  })

  it("sem sinal confiável → unknown (NÃO inventa recurring)", () => {
    expect(classifyWorkload({ operation: "ai_evaluation" })).toBe("unknown")
    expect(classifyWorkload({ operation: "recommendation_rank", metadata: {} })).toBe("unknown")
  })

  it("explícito recurring é respeitado mesmo em operação admin", () => {
    expect(
      classifyWorkload({ operation: "calibration_audit", metadata: { workload_type: "recurring" } }),
    ).toBe("recurring")
  })
})
