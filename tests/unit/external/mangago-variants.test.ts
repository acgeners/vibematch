import { describe, expect, it, vi } from "vitest"
import { buildResolveVariants, expandAlias, normalizeQuery } from "@/lib/external/mangago-variants"
import type { MangagoVariantDeps, SourceTitles } from "@/lib/external/mangago-variants"
import { normalizeText } from "@/lib/external/title-match"

describe("expandAlias", () => {
  it("divide em ; e /", () => {
    expect(expandAlias("A ; B / C")).toEqual(["A", "B", "C"])
  })

  it("extrai a parte principal de um subtítulo entre til (mantém o original)", () => {
    expect(expandAlias("Kaguya-sama wa Kokurasetai ~Tensai-tachi no Renai Zunousen~")).toEqual([
      "Kaguya-sama wa Kokurasetai ~Tensai-tachi no Renai Zunousen~",
      "Kaguya-sama wa Kokurasetai",
    ])
    // fullwidth ～ também
    expect(expandAlias("かぐや様は告らせたい ～天才たち～")).toContain("かぐや様は告らせたい")
  })

  it("não quebra quando o til não é subtítulo de sufixo", () => {
    expect(expandAlias("A~B")).toEqual(["A~B"]) // um único til → sem split
    expect(expandAlias("~sub~")).toEqual(["~sub~"]) // prefixo < 2 chars → sem split
  })
})

describe("normalizeQuery", () => {
  it("remove brackets decorativos, preserva CJK e latino", () => {
    expect(normalizeQuery("【Oshi no Ko】")).toBe("Oshi no Ko")
    expect(normalizeQuery("「呪術廻戦」")).toBe("呪術廻戦")
    expect(normalizeQuery("Solo Leveling")).toBe("Solo Leveling")
  })
})

describe("buildResolveVariants", () => {
  it("só título direto → vira query e target", async () => {
    const v = await buildResolveVariants({ title: "Solo Leveling" })
    expect(v.queries).toEqual(["Solo Leveling"])
    expect(v.targets).toEqual(["Solo Leveling"])
    expect(v.year).toBeUndefined()
  })

  it("AniList: primary é a 1ª query; targets são mais amplos; year vem junto", async () => {
    const deps: MangagoVariantDeps = {
      anilist: async (): Promise<SourceTitles> => ({
        primary: "Solo Leveling",
        native: "나 혼자만 레벨업",
        aliases: ["Ore dake Level Up na Ken", "Only I Level Up"],
        year: 2018,
      }),
    }
    const v = await buildResolveVariants({ anilistId: 1 }, deps)
    expect(v.queries[0]).toBe("Solo Leveling") // english/romaji primeiro
    expect(v.queries).toContain("나 혼자만 레벨업") // native também vira query
    expect(v.queries.length).toBeLessThanOrEqual(3)
    // targets incluem tudo (primary + native + aliases)
    for (const t of ["Solo Leveling", "나 혼자만 레벨업", "Ore dake Level Up na Ken", "Only I Level Up"]) {
      expect(v.targets.map(normalizeText)).toContain(normalizeText(t))
    }
    expect(v.year).toBe(2018)
  })

  it("remove 【】 nas queries e deduplica variações de caixa/pontuação", async () => {
    const deps: MangagoVariantDeps = {
      anilist: async (): Promise<SourceTitles> => ({
        primary: "【Oshi no Ko】",
        native: "【推しの子】",
        aliases: ["Oshi no Ko", "OSHI NO KO"],
      }),
    }
    const v = await buildResolveVariants({ anilistId: 1 }, deps)
    expect(v.queries).toContain("Oshi no Ko")
    expect(v.queries.every((q) => !q.includes("【"))).toBe(true)
    // "Oshi no Ko", "OSHI NO KO" e "【Oshi no Ko】" colapsam num único target
    const oshiTargets = v.targets.filter((t) => normalizeText(t) === normalizeText("Oshi no Ko"))
    expect(oshiTargets.length).toBe(1)
  })

  it("MAL e MangaUpdates: reaproveita fetchers injetados", async () => {
    const deps: MangagoVariantDeps = {
      mal: async (): Promise<SourceTitles> => ({ primary: "Berserk", aliases: ["ベルセルク"], year: 1989 }),
      mangaUpdates: async (): Promise<SourceTitles> => ({ primary: "Berserk", aliases: ["Berserk (Miura)"] }),
    }
    const v = await buildResolveVariants({ malId: 2, mangaUpdatesId: "33" }, deps)
    expect(v.queries).toContain("Berserk")
    expect(v.year).toBe(1989)
  })

  it("ID sem fetcher (dep ausente) → não busca, degrada", async () => {
    const v = await buildResolveVariants({ anilistId: 999 }, {}) // sem deps
    expect(v.queries).toEqual([])
    expect(v.targets).toEqual([])
  })

  it("falha do fetcher não propaga (fail-soft) e usa o título direto", async () => {
    const deps: MangagoVariantDeps = {
      anilist: async () => {
        throw new Error("network down")
      },
    }
    const v = await buildResolveVariants({ title: "Solo Leveling", anilistId: 1 }, deps)
    expect(v.queries).toEqual(["Solo Leveling"])
  })

  it("subtítulo de alias vira target extra (via expandAlias)", async () => {
    const deps: MangagoVariantDeps = {
      anilist: async (): Promise<SourceTitles> => ({
        primary: "Kaguya-sama Wants to be Confessed To",
        aliases: ["Kaguya-sama wa Kokurasetai ~Tensai-tachi no Renai Zunousen~"],
      }),
    }
    const v = await buildResolveVariants({ anilistId: 1 }, deps)
    expect(v.targets.map(normalizeText)).toContain(normalizeText("Kaguya-sama wa Kokurasetai"))
  })

  it("respeita o teto de 3 queries mesmo com muitas variantes", async () => {
    const deps: MangagoVariantDeps = {
      anilist: async (): Promise<SourceTitles> => ({
        primary: "A",
        native: "B",
        aliases: ["C", "D", "E", "F", "G"],
      }),
    }
    const v = await buildResolveVariants({ title: "Z", anilistId: 1 }, deps)
    expect(v.queries.length).toBeLessThanOrEqual(3)
  })

  it("não chama fetcher que não foi solicitado", async () => {
    const mal = vi.fn()
    await buildResolveVariants({ title: "X" }, { mal })
    expect(mal).not.toHaveBeenCalled()
  })
})
