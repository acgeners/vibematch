import { describe, expect, it, vi } from "vitest"
import { resolveMangagoUrl } from "@/lib/external/mangago-resolve"
import type {
  MangagoResolveEvent,
  MangagoSearch,
  MangagoSearchCandidate,
  ResolveMangagoOptions,
} from "@/lib/external/mangago-resolve"
import type { ResolveVariants } from "@/lib/external/mangago-variants"
import searchSets from "@/tests/fixtures/mangago/search-sets.json"

const SETS = searchSets.sets as Record<string, MangagoSearchCandidate[]>
const searchFrom =
  (map: Record<string, MangagoSearchCandidate[]>): MangagoSearch =>
  async (q) =>
    map[q] ?? []
const fixedVariants =
  (queries: string[], targets: string[], year?: number) => async (): Promise<ResolveVariants> => ({
    queries,
    targets,
    year,
  })

/** Captura os eventos e devolve o array + as opções. Garante 1 evento por chamada. */
function capture(partial: Partial<ResolveMangagoOptions> & { search: MangagoSearch }) {
  const events: MangagoResolveEvent[] = []
  const opts: ResolveMangagoOptions = { ...partial, onResult: (e) => events.push(e) }
  return { events, opts }
}

describe("E7 — evento estruturado por caminho de saída", () => {
  it("1. no_variants → skipped, queriesRun=0, candidates=0, sem chamar search", async () => {
    const search = vi.fn<MangagoSearch>(async () => [])
    const { events, opts } = capture({ search, buildVariants: fixedVariants([], []) })
    const r = await resolveMangagoUrl({}, opts)
    expect(r).toBeNull()
    expect(search).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "skipped", result: "no_variants", queriesRun: 0, candidates: 0 })
  })

  it("2. no_candidates → result, candidates=0 (buscas OK, sem resultado)", async () => {
    const { events, opts } = capture({
      search: async () => [],
      buildVariants: fixedVariants(["nada"], ["nada"]),
    })
    await resolveMangagoUrl({}, opts)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "result", result: "no_candidates", candidates: 0, queriesRun: 1 })
  })

  it("3. uma query falha, outra funciona → 1 evento, sem error, usa candidatos válidos", async () => {
    const search: MangagoSearch = async (q) => {
      if (q === "boom") throw new Error("x")
      return SETS["Solo Leveling"]
    }
    const { events, opts } = capture({ search, buildVariants: fixedVariants(["boom", "Solo Leveling"], ["Solo Leveling"]) })
    const r = await resolveMangagoUrl({}, opts)
    expect(r?.slug).toBe("solo_leveling")
    expect(events).toHaveLength(1)
    expect(events[0].result).not.toBe("error")
    expect(events[0].result).not.toBe("search_failed")
  })

  it("4. todas as queries falham → null, search_failed, sem throw", async () => {
    const search: MangagoSearch = async () => {
      throw new Error("down")
    }
    const { events, opts } = capture({ search, buildVariants: fixedVariants(["a", "b"], ["Solo Leveling"]) })
    const r = await resolveMangagoUrl({}, opts)
    expect(r).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "result", result: "search_failed", candidates: 0, queriesRun: 2 })
  })

  it("5. reject → bandReason presente no evento", async () => {
    const { events, opts } = capture({ search: searchFrom(SETS), buildVariants: fixedVariants(["Kingdom"], ["Kingdom"]) })
    await resolveMangagoUrl({}, opts)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "result", result: "reject", band: "reject", bandReason: "below_accept" })
  })

  it("6. review → topScore e margin presentes", async () => {
    const { events, opts } = capture({ search: searchFrom(SETS), buildVariants: fixedVariants(["One Piece"], ["One Piece"]) })
    await resolveMangagoUrl({}, opts)
    const e = events[0]
    expect(e.result).toBe("review")
    expect(e.band).toBe("review")
    expect(typeof e.topScore).toBe("number")
    expect(typeof e.margin).toBe("number")
    expect(e.bandReason).toBeTruthy()
  })

  it("7. auto → slug, topScore, matchedTarget e queryUsed presentes", async () => {
    const { events, opts } = capture({
      search: searchFrom(SETS),
      buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling", "나 혼자만 레벨업"]),
    })
    await resolveMangagoUrl({}, opts)
    const e = events[0]
    expect(e).toMatchObject({ event: "result", result: "auto", band: "auto", slug: "solo_leveling" })
    expect(e.topScore).toBe(1)
    expect(e.matchedTarget).toBe("Solo Leveling")
    expect(e.queryUsed).toBe("Solo Leveling")
    expect(e.url).toBe("https://www.mangago.me/read-manga/solo_leveling/")
    expect(e.yearConfirmation).toMatchObject({ attempted: false })
  })

  it("8. year_confirmed → result e method year_confirmed, yearConfirmation.promoted", async () => {
    const fetchYear = vi.fn(async (slug: string) => ({ jujutsu_kaisen: 2018, jujutsu_kaisen_modulo: 2024 })[slug] ?? null)
    const { events, opts } = capture({
      search: searchFrom(SETS),
      buildVariants: fixedVariants(["呪術廻戦"], ["呪術廻戦"], 2018),
      confirmYear: true,
      fetchYear,
    })
    await resolveMangagoUrl({}, opts)
    const e = events[0]
    expect(e.result).toBe("year_confirmed")
    expect(e.band).toBe("auto")
    expect(e.method).toBe("year_confirmed")
    expect(e.yearConfirmation).toEqual({ attempted: true, promoted: true, candidatesChecked: 2 })
  })

  it("9. confirmYear=false → yearConfirmation.attempted:false", async () => {
    const { events, opts } = capture({
      search: searchFrom(SETS),
      buildVariants: fixedVariants(["呪術廻戦"], ["呪術廻戦"], 2018),
      confirmYear: false,
    })
    await resolveMangagoUrl({}, opts)
    expect(events[0].yearConfirmation).toEqual({ attempted: false, promoted: false, candidatesChecked: 0 })
  })

  it("10. elapsedMs determinístico com opts.now mockado", async () => {
    let t = 1000
    const now = () => {
      const v = t
      t += 250
      return v
    }
    const { events, opts } = capture({
      search: searchFrom(SETS),
      buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]),
      now,
    })
    await resolveMangagoUrl({}, opts)
    // started = 1000 (1ª chamada), emit lê now() = 1250 → 250
    expect(events[0].elapsedMs).toBe(250)
  })

  it("11. exatamente 1 evento final por chamada (todos os caminhos)", async () => {
    const cases: Array<Partial<ResolveMangagoOptions> & { search: MangagoSearch }> = [
      { search: async () => [], buildVariants: fixedVariants([], []) }, // no_variants
      { search: async () => [], buildVariants: fixedVariants(["x"], ["x"]) }, // no_candidates
      {
        search: async () => {
          throw new Error("z")
        },
        buildVariants: fixedVariants(["x"], ["x"]),
      }, // search_failed
      { search: searchFrom(SETS), buildVariants: fixedVariants(["Kingdom"], ["Kingdom"]) }, // reject
      { search: searchFrom(SETS), buildVariants: fixedVariants(["One Piece"], ["One Piece"]) }, // review
      { search: searchFrom(SETS), buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]) }, // auto
      {
        search: searchFrom(SETS),
        buildVariants: async () => {
          throw new Error("boom")
        },
      }, // error
    ]
    for (const c of cases) {
      const { events, opts } = capture(c)
      await resolveMangagoUrl({}, opts)
      expect(events).toHaveLength(1)
    }
  })

  it("8b. erro inesperado (buildVariants lança) → result:error, sem throw", async () => {
    const { events, opts } = capture({
      search: searchFrom(SETS),
      buildVariants: async () => {
        throw new Error("kaboom")
      },
    })
    const r = await resolveMangagoUrl({}, opts)
    expect(r).toBeNull()
    expect(events[0]).toMatchObject({ event: "result", result: "error", errorKind: "Error" })
  })
})
