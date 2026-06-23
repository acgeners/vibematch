import { describe, it, expect } from "vitest"
import { classifyWorksWithoutTags, type TagWorkMetaRow } from "@/lib/tags/no-tags-classify"

function work(id: string, title: string, over: Partial<TagWorkMetaRow> = {}): TagWorkMetaRow {
  return { id, title, coverUrl: null, publicationStatus: "Ongoing", personalStatus: "—", aiEvalStatus: "done", canonicalPresent: true, tagCount: 0, ...over }
}

describe("classifyWorksWithoutTags", () => {
  const base = {
    works: [work("a", "Alpha"), work("b", "Beta"), work("c", "Gamma")],
    acceptedSourcesByWork: new Map<string, string[]>([["a", ["anilist", "mangaupdates"]], ["c", []]]),
    goldenWorkIds: new Set<string>(["b"]),
  }

  it("monta todas (sem filtro) ordenadas por título", () => {
    const r = classifyWorksWithoutTags({ ...base, filters: {} })
    expect(r.map((w) => w.title)).toEqual(["Alpha", "Beta", "Gamma"])
  })
  it("filtro por título (substring, case-insensitive)", () => {
    expect(classifyWorksWithoutTags({ ...base, filters: { q: "amm" } }).map((w) => w.title)).toEqual(["Gamma"])
  })
  it("filtro fonte externa: yes só com fonte aceita; no só sem", () => {
    expect(classifyWorksWithoutTags({ ...base, filters: { hasExternal: "yes" } }).map((w) => w.id)).toEqual(["a"])
    expect(classifyWorksWithoutTags({ ...base, filters: { hasExternal: "no" } }).map((w) => w.id)).toEqual(["b", "c"])
  })
  it("filtro golden (badge correto)", () => {
    const r = classifyWorksWithoutTags({ ...base, filters: { goldenOnly: true } })
    expect(r.map((w) => w.id)).toEqual(["b"])
    expect(r[0]!.inGolden).toBe(true)
  })
  it("tagCount reflete a contagem da meta row", () => {
    const r = classifyWorksWithoutTags({
      ...base,
      works: [work("a", "Alpha", { tagCount: 7 }), work("b", "Beta", { tagCount: 0 })],
      filters: {},
    })
    expect(r.find((w) => w.id === "a")!.tagCount).toBe(7)
    expect(r.find((w) => w.id === "b")!.tagCount).toBe(0)
  })
  it("acceptedExternalSources deduplicado e ordenado", () => {
    const r = classifyWorksWithoutTags({
      ...base,
      acceptedSourcesByWork: new Map([["a", ["mangaupdates", "anilist", "anilist"]]]),
      filters: {},
    })
    expect(r.find((w) => w.id === "a")!.acceptedExternalSources).toEqual(["anilist", "mangaupdates"])
  })
})
