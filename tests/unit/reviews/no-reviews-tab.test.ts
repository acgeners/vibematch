import { describe, it, expect } from "vitest"
import { isUsefulReviewText, isUsefulReviewLength, MIN_USEFUL_REVIEW_LENGTH } from "@/lib/reviews/useful-review"
import { classifyWorksWithoutReviews, type WorkMetaRow } from "@/lib/reviews/no-review-classify"

function work(id: string, title: string, over: Partial<WorkMetaRow> = {}): WorkMetaRow {
  return { id, title, coverUrl: null, publicationStatus: "Ongoing", personalStatus: "—", aiEvalStatus: "done", canonicalPresent: true, usefulReviewCount: 0, ...over }
}

describe("useful-review rule (centralizada)", () => {
  it("texto curto/vazio NÃO é útil; ≥40 (trim) é útil", () => {
    expect(isUsefulReviewText("")).toBe(false)
    expect(isUsefulReviewText("   ")).toBe(false)
    expect(isUsefulReviewText("curta")).toBe(false)
    expect(isUsefulReviewText("x".repeat(MIN_USEFUL_REVIEW_LENGTH))).toBe(true)
    expect(isUsefulReviewText("  " + "x".repeat(40) + "  ")).toBe(true)
  })
  it("proxy por text_length espelha a regra (≥40)", () => {
    expect(isUsefulReviewLength(0)).toBe(false)
    expect(isUsefulReviewLength(39)).toBe(false)
    expect(isUsefulReviewLength(40)).toBe(true)
    expect(isUsefulReviewLength(null)).toBe(false)
  })
})

describe("classifyWorksWithoutReviews", () => {
  const base = {
    works: [work("a", "Alpha"), work("b", "Beta"), work("c", "Gamma")],
    lastFetchedByWork: new Map<string, string | null>([["a", "2026-06-15T00:00:00Z"]]),
    acceptedSourcesByWork: new Map<string, string[]>([["a", ["anilist", "mangaupdates"]], ["c", []]]),
    goldenWorkIds: new Set<string>(["b"]),
  }

  it("monta todas (sem filtro) ordenadas por título, usefulReviewCount=0", () => {
    const r = classifyWorksWithoutReviews({ ...base, filters: {} })
    expect(r.map((w) => w.title)).toEqual(["Alpha", "Beta", "Gamma"])
    expect(r.every((w) => w.usefulReviewCount === 0)).toBe(true)
  })
  it("filtro por título (substring, case-insensitive)", () => {
    expect(classifyWorksWithoutReviews({ ...base, filters: { q: "amm" } }).map((w) => w.title)).toEqual(["Gamma"])
  })
  it("filtro fonte externa: yes só com fonte aceita; no só sem", () => {
    expect(classifyWorksWithoutReviews({ ...base, filters: { hasExternal: "yes" } }).map((w) => w.id)).toEqual(["a"])
    // b sem entrada no mapa (=[]), c com [] → ambos "sem fonte"
    expect(classifyWorksWithoutReviews({ ...base, filters: { hasExternal: "no" } }).map((w) => w.id)).toEqual(["b", "c"])
  })
  it("filtro golden (badge correto)", () => {
    const r = classifyWorksWithoutReviews({ ...base, filters: { goldenOnly: true } })
    expect(r.map((w) => w.id)).toEqual(["b"])
    expect(r[0]!.inGolden).toBe(true)
    expect(classifyWorksWithoutReviews({ ...base, filters: {} }).find((w) => w.id === "a")!.inGolden).toBe(false)
  })
  it("lastFetchedAt: presente quando há; null quando não há (sem inventar)", () => {
    const r = classifyWorksWithoutReviews({ ...base, filters: {} })
    expect(r.find((w) => w.id === "a")!.lastFetchedAt).toBe("2026-06-15T00:00:00Z")
    expect(r.find((w) => w.id === "b")!.lastFetchedAt).toBeNull()
  })
  it("acceptedExternalSources deduplicado e ordenado", () => {
    const r = classifyWorksWithoutReviews({
      ...base,
      acceptedSourcesByWork: new Map([["a", ["mangaupdates", "anilist", "anilist"]]]),
      filters: {},
    })
    expect(r.find((w) => w.id === "a")!.acceptedExternalSources).toEqual(["anilist", "mangaupdates"])
  })
  it("usefulReviewCount reflete a contagem da meta row (não mais fixo em 0)", () => {
    const r = classifyWorksWithoutReviews({
      ...base,
      works: [work("a", "Alpha", { usefulReviewCount: 2 }), work("b", "Beta", { usefulReviewCount: 0 })],
      filters: {},
    })
    expect(r.find((w) => w.id === "a")!.usefulReviewCount).toBe(2)
    expect(r.find((w) => w.id === "b")!.usefulReviewCount).toBe(0)
  })
})
