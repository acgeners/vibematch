import { vi, describe, it, expect } from "vitest"

// Mock server-only to prevent vitest error in client environment tests
vi.mock("server-only", () => ({}))

// Mock useRouter from next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

import { hasChanges } from "@/components/titles/work-status-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"

const baseValues: WorkStatusValues = {
  personal_status: "Reading",
  personal_status_id: 2,
  synopsis_quality: "♥♥♥♥",
  observation_adjustment: 0,
  observations: "É legal até, mas acho que foi ficando meio parado",
  chapters_read: null,
  last_read_at: null,
  user_score: null,
  post_story_score: null,
  post_fl_score: null,
  post_ml_score: null,
  post_character_development_score: null,
  post_pacing_score: null,
  post_art_visual_score: null,
  post_impact_immersion_score: null,
  post_originality_score: null,
}

describe("hasChanges in WorkStatusForm", () => {
  it("retorna false quando nada mudou", () => {
    expect(hasChanges(baseValues, baseValues)).toBe(false)
  })

  it("retorna false quando observations tem quebras de linha diferentes ou espaços extras no fim", () => {
    const withCarriageReturn = {
      ...baseValues,
      observations: "É legal até,\r\nmas acho que foi ficando meio parado",
    }
    const withNewline = {
      ...baseValues,
      observations: "É legal até,\nmas acho que foi ficando meio parado",
    }
    expect(hasChanges(withCarriageReturn, withNewline)).toBe(false)
  })

  it("retorna false quando observations tem trailing whitespaces", () => {
    const current = {
      ...baseValues,
      observations: "É legal até, mas acho que foi ficando meio parado \n ",
    }
    expect(hasChanges(baseValues, current)).toBe(false)
  })

  it("retorna true quando observações mudou de fato", () => {
    const current = {
      ...baseValues,
      observations: "Outro texto completamente diferente",
    }
    expect(hasChanges(baseValues, current)).toBe(true)
  })

  it("retorna false quando campos vazios mudam de null para string vazia", () => {
    const current = {
      ...baseValues,
      last_read_at: "",
    }
    expect(hasChanges(baseValues, current)).toBe(false)
  })
})
