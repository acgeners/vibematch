import { describe, it, expect } from "vitest"
import { parseAiCallMetadata } from "@/lib/ai-observability/schemas"

describe("parseAiCallMetadata", () => {
  it("lê os campos novos de observabilidade", () => {
    const m = parseAiCallMetadata({
      logical_request_id: "req-123",
      workload_type: "recurring",
      cache_status: "miss",
      error_category: "provider_image_invalid_request",
      image_status: "fetch_success",
    })
    expect(m.logical_request_id).toBe("req-123")
    expect(m.workload_type).toBe("recurring")
    expect(m.cache_status).toBe("miss")
    expect(m.error_category).toBe("provider_image_invalid_request")
    expect(m.image_status).toBe("fetch_success")
  })

  it("preserva campos legados via passthrough", () => {
    const m = parseAiCallMetadata({ work_id: "w1", attempt: 1, hasImage: true, isOverride: true })
    expect(m.work_id).toBe("w1")
    expect(m.attempt).toBe(1)
    expect(m.hasImage).toBe(true)
    expect(m.isOverride).toBe(true)
  })

  it("valores inválidos viram undefined sem lançar (tolerante)", () => {
    const m = parseAiCallMetadata({ workload_type: "inexistente", cache_status: 42, attempt: "x" })
    expect(m.workload_type).toBeUndefined()
    expect(m.cache_status).toBeUndefined()
    expect(m.attempt).toBeUndefined()
  })

  it("null / não-objeto → objeto vazio", () => {
    expect(parseAiCallMetadata(null)).toEqual({})
    expect(parseAiCallMetadata("nope")).toEqual({})
    expect(parseAiCallMetadata(undefined)).toEqual({})
  })
})
