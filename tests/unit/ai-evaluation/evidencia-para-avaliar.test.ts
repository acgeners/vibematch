import { describe, it, expect } from "vitest"
import {
  MIN_USEFUL_REVIEWS_FOR_EVAL,
  countUsefulReviews,
  describeFewReviews,
  hasEnoughReviewsForEval,
  selectReadyToEvaluate,
} from "@/lib/ai-evaluation/eval-evidence"
import { parseAttrEvalFilters } from "@/lib/ai-evaluation/attr-eval-filters"

// O piso de reviews úteis para avaliar (medido em 2026-11-12) e o filtro "Prontas para avaliar".

describe("piso de reviews úteis para a avaliação", () => {
  it("é 4, o número da medição", () => {
    expect(MIN_USEFUL_REVIEWS_FOR_EVAL).toBe(4)
    expect(hasEnoughReviewsForEval(3)).toBe(false)
    expect(hasEnoughReviewsForEval(4)).toBe(true)
  })

  it("conta só review útil (40+ caracteres), pela régua central", () => {
    const longa = "x".repeat(40)
    expect(countUsefulReviews([{ text: longa }, { text: "curta" }, { text: null }, { text: `  ${longa}  ` }])).toBe(2)
  })

  it("o texto da pergunta traz as duas contagens, no singular quando é 1", () => {
    expect(describeFewReviews(1, 3)).toMatch(/3 reviews, 1 útil /)
    expect(describeFewReviews(2, 1)).toMatch(/1 review, 2 úteis/)
  })
})

describe("filtro 'Prontas para avaliar'", () => {
  it("🔴 das nunca avaliadas, só as com 4+ úteis; sem contagem conta como zero", () => {
    const useful = new Map([["a", 4], ["b", 3], ["c", 12]])
    expect(selectReadyToEvaluate(["a", "b", "c", "d"], useful)).toEqual(["a", "c"])
  })

  it("é um filtro válido na URL", () => {
    expect(parseAttrEvalFilters("ready")).toEqual(["ready"])
  })
})
