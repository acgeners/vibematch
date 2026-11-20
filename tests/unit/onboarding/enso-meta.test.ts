import { describe, it, expect } from "vitest"
import { ENSO_GOAL } from "@/lib/onboarding/enso"
import { MIN_TRAIN_EXPECTED } from "@/lib/calculations/expected"

describe("meta do ensō", () => {
  it("é o mínimo de notas com que a Nota Prevista liga — senão o círculo fecha e ela não liga", () => {
    expect(ENSO_GOAL).toBe(MIN_TRAIN_EXPECTED)
  })
})
