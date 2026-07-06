import { describe, expect, it, vi } from "vitest"
import { resolveMangagoUrl } from "@/lib/external/mangago-resolve"
import type { MangagoSearch, MangagoSearchCandidate, ResolveMangagoOptions } from "@/lib/external/mangago-resolve"
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

/** fetchYear mockado por mapa slug→ano, com contador de chamadas. */
function yearFetcher(map: Record<string, number | null>) {
  const fn = vi.fn(async (slug: string) => map[slug] ?? null)
  return fn
}

function opts(p: Partial<ResolveMangagoOptions> & { search: MangagoSearch }): ResolveMangagoOptions {
  return p
}

// Jujutsu: jujutsu_kaisen e jujutsu_kaisen_modulo empatam em 1.0 (mesmo native) → review por margem 0.
const JJK_VARIANTS = fixedVariants(["呪術廻戦"], ["呪術廻戦"], 2018)
const jjkSearch = searchFrom(SETS)

describe("E6 — corroboração por ano: não dispara fetchYear", () => {
  it("1. confirmYear=false → não chama fetchYear, mantém review", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2018, jujutsu_kaisen_modulo: 2024 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: false, fetchYear }))
    expect(r?.band).toBe("review")
    expect(fetchYear).not.toHaveBeenCalled()
  })

  it("12. sem opts.confirmYear → idêntico ao E5 (review, sem fetchYear)", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2018 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, fetchYear }))
    expect(r?.band).toBe("review")
    expect(r?.method).not.toBe("year_confirmed")
    expect(fetchYear).not.toHaveBeenCalled()
  })

  it("2. sem variants.year → não chama fetchYear, mantém review", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2018 })
    const r = await resolveMangagoUrl(
      {},
      opts({ search: jjkSearch, buildVariants: fixedVariants(["呪術廻戦"], ["呪術廻戦"]), confirmYear: true, fetchYear })
    )
    expect(r?.band).toBe("review")
    expect(fetchYear).not.toHaveBeenCalled()
  })

  it("3. resultado já AUTO → não chama fetchYear", async () => {
    const fetchYear = yearFetcher({ solo_leveling: 2018 })
    const r = await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"], 2018),
        confirmYear: true,
        fetchYear,
      })
    )
    expect(r?.band).toBe("auto")
    expect(r?.method).not.toBe("year_confirmed")
    expect(fetchYear).not.toHaveBeenCalled()
  })

  it("4. REJECT/null → não chama fetchYear", async () => {
    const fetchYear = yearFetcher({})
    const r = await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Kingdom"], ["Kingdom"], 2006),
        confirmYear: true,
        fetchYear,
      })
    )
    expect(r).toBeNull()
    expect(fetchYear).not.toHaveBeenCalled()
  })
})

describe("E6 — corroboração por ano: decisão", () => {
  it("5. empate com anos diferentes → só um casa → promove p/ AUTO", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2018, jujutsu_kaisen_modulo: 2024 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("auto")
    expect(r?.method).toBe("year_confirmed")
    expect(r?.slug).toBe("jujutsu_kaisen")
    expect(fetchYear).toHaveBeenCalledTimes(2)
  })

  it("5b. quem casa o ano é o 2º colocado → promoção re-seleciona o vencedor", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2024, jujutsu_kaisen_modulo: 2018 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("auto")
    expect(r?.method).toBe("year_confirmed")
    expect(r?.slug).toBe("jujutsu_kaisen_modulo")
  })

  it("6. duplicata com o MESMO ano compatível → mantém review", async () => {
    const fetchYear = yearFetcher({
      kaguya_sama_wants_to_be_confessed_to_the_geniuses_war_of_love_and_brains: 2015,
      kaguya_wants_to_be_confessed_to_the_geniuses_war_of_love_and_brains: 2015,
    })
    const r = await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Kaguya-sama wa Kokurasetai"], ["Kaguya-sama wa Kokurasetai"], 2015),
        confirmYear: true,
        fetchYear,
      })
    )
    expect(r?.band).toBe("review")
    expect(r?.method).not.toBe("year_confirmed")
  })

  it("7. nenhum ano compatível → mantém review", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2010, jujutsu_kaisen_modulo: 2024 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("review")
  })

  it("8. fetchYear retorna null → mantém review", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: null, jujutsu_kaisen_modulo: null })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("review")
  })

  it("9. fetchYear lança erro → sem throw, mantém review", async () => {
    const fetchYear = vi.fn(async () => {
      throw new Error("detail fetch failed")
    })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("review")
  })

  it("10. tolerância ±1 (2018 vs 2019 casa)", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2019, jujutsu_kaisen_modulo: 2024 })
    const r = await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(r?.band).toBe("auto")
    expect(r?.slug).toBe("jujutsu_kaisen")
  })

  it("11. nunca consulta mais de 2 candidatos", async () => {
    const fetchYear = yearFetcher({ jujutsu_kaisen: 2018, jujutsu_kaisen_modulo: 2024 })
    await resolveMangagoUrl({}, opts({ search: jjkSearch, buildVariants: JJK_VARIANTS, confirmYear: true, fetchYear }))
    expect(fetchYear.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
