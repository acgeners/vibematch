import { describe, it, expect, vi } from "vitest"

// searchMangago é mockado (sem rede/FlareSolverr). fetchMangagoById é stubado
// porque mangago-year-deps o importa do mesmo módulo.
vi.mock("@/lib/external/mangago", () => ({
  searchMangago: vi.fn(async () => [
    { id: "mangago:solo_leveling", source: "mangago", title: "Solo Leveling", alternativeTitles: ["나 혼자만 레벨업"] },
  ]),
  fetchMangagoById: vi.fn(),
}))

import {
  toMangagoCandidates,
  mangagoSearchAdapter,
  buildMangagoResolveProdOpts,
  readConfirmYearFromEnv,
  resolveMangagoUrlProd,
} from "@/lib/external/mangago-resolve-prod"
import { MangagoMemoryResolveCache } from "@/lib/external/mangago-cache"
import { searchMangago } from "@/lib/external/mangago"
import type { ExternalSearchResult } from "@/lib/external/types"

const row = (over: Partial<ExternalSearchResult>): ExternalSearchResult => ({
  id: "mangago:x",
  source: "mangago",
  title: "X",
  ...over,
})

describe("toMangagoCandidates (puro)", () => {
  it("1 & 2. mapeia id 'mangago:{slug}' → slug e preserva title", () => {
    const [c] = toMangagoCandidates([row({ id: "mangago:solo_leveling", title: "Solo Leveling" })])
    expect(c.slug).toBe("solo_leveling")
    expect(c.title).toBe("Solo Leveling")
  })

  it("3. alternativeTitles → otherTitles", () => {
    const [c] = toMangagoCandidates([row({ alternativeTitles: ["Only I Level Up", "나 혼자만 레벨업"] })])
    expect(c.otherTitles).toEqual(["Only I Level Up", "나 혼자만 레벨업"])
  })

  it("4. sem alternativeTitles → otherTitles []", () => {
    const [c] = toMangagoCandidates([row({ alternativeTitles: undefined })])
    expect(c.otherTitles).toEqual([])
  })

  it("5. descarta linha sem slug válido (id vazio ou outro domínio)", () => {
    expect(toMangagoCandidates([row({ id: "mangago:" })])).toEqual([])
    expect(toMangagoCandidates([row({ id: "https://evil.com/read-manga/x/" })])).toEqual([])
  })

  it("aceita URL do Mangago no id (extractMangagoSlug)", () => {
    const [c] = toMangagoCandidates([row({ id: "https://www.mangago.me/read-manga/one_piece/", title: "One Piece" })])
    expect(c.slug).toBe("one_piece")
  })

  it("6. descarta linha sem título útil", () => {
    expect(toMangagoCandidates([row({ title: "" })])).toEqual([])
    expect(toMangagoCandidates([row({ title: "   " })])).toEqual([])
  })

  it("7. não coloca o slug em otherTitles", () => {
    const [c] = toMangagoCandidates([row({ id: "mangago:solo_leveling", alternativeTitles: ["alias"] })])
    expect(c.otherTitles).not.toContain("solo_leveling")
    expect(c.otherTitles).toEqual(["alias"])
  })

  it("8. preserva CJK/Hangul/kana nos aliases", () => {
    const [c] = toMangagoCandidates([row({ alternativeTitles: ["呪術廻戦", "나 혼자만 레벨업", "ワンピース"] })])
    expect(c.otherTitles).toEqual(["呪術廻戦", "나 혼자만 레벨업", "ワンピース"])
  })

  it("entrada vazia/nula → []", () => {
    expect(toMangagoCandidates([])).toEqual([])
    // @ts-expect-error defensivo
    expect(toMangagoCandidates(undefined)).toEqual([])
  })
})

describe("mangagoSearchAdapter", () => {
  it("9. chama searchMangago e converte o resultado", async () => {
    const candidates = await mangagoSearchAdapter("solo leveling")
    expect(searchMangago).toHaveBeenCalledWith("solo leveling")
    expect(candidates).toEqual([{ slug: "solo_leveling", title: "Solo Leveling", otherTitles: ["나 혼자만 레벨업"] }])
  })
})

describe("buildMangagoResolveProdOpts", () => {
  it("10. passa search/buildVariants/bandConfig/cache/fetchYear/confirmYear/onResult", () => {
    const opts = buildMangagoResolveProdOpts()
    expect(typeof opts.search).toBe("function")
    expect(typeof opts.buildVariants).toBe("function")
    expect(opts.bandConfig).toMatchObject({ autoMinScore: expect.any(Number), acceptMinScore: expect.any(Number) })
    expect(opts.cache).toBeInstanceOf(MangagoMemoryResolveCache)
    expect(typeof opts.fetchYear).toBe("function")
    expect(typeof opts.confirmYear).toBe("boolean")
    expect(typeof opts.onResult).toBe("function")
  })

  it("13. cache é injetável por override (não depende do singleton)", () => {
    const fake = new MangagoMemoryResolveCache()
    expect(buildMangagoResolveProdOpts({ cache: fake }).cache).toBe(fake)
    // o default usa o singleton de módulo (≠ do fake)
    expect(buildMangagoResolveProdOpts().cache).not.toBe(fake)
    // e o singleton é estável entre chamadas
    expect(buildMangagoResolveProdOpts().cache).toBe(buildMangagoResolveProdOpts().cache)
  })
})

describe("readConfirmYearFromEnv", () => {
  it("11. true/1/yes → true", () => {
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "true" })).toBe(true)
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "1" })).toBe(true)
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "yes" })).toBe(true)
  })
  it("12. ausente/vazio/inválido/false → false", () => {
    expect(readConfirmYearFromEnv({})).toBe(false)
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "" })).toBe(false)
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "maybe" })).toBe(false)
    expect(readConfirmYearFromEnv({ MANGAGO_RESOLVE_CONFIRM_YEAR: "0" })).toBe(false)
  })
})

describe("resolveMangagoUrlProd (smoke — wiring end-to-end, searchMangago mockado)", () => {
  it("14. resolve sem rede e sem throw", async () => {
    const r = await resolveMangagoUrlProd({ title: "Solo Leveling" })
    expect(r?.slug).toBe("solo_leveling")
    expect(r?.band).toBe("auto")
  })
})
