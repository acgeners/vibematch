import { describe, expect, it, vi } from "vitest"
import { resolveMangagoUrl } from "@/lib/external/mangago-resolve"
import type { MangagoSearch, MangagoSearchCandidate, ResolveMangagoOptions } from "@/lib/external/mangago-resolve"
import type { ResolveVariants } from "@/lib/external/mangago-variants"
import searchSets from "@/tests/fixtures/mangago/search-sets.json"

const SETS = searchSets.sets as Record<string, MangagoSearchCandidate[]>

/** search mockado a partir dos conjuntos reais capturados de mangago.me. */
function searchFrom(map: Record<string, MangagoSearchCandidate[]>): MangagoSearch {
  return async (query: string) => map[query] ?? []
}

/** buildVariants fixo (isola E4 dos fetchers do E3). */
function fixedVariants(queries: string[], targets: string[], year?: number) {
  return async (): Promise<ResolveVariants> => ({ queries, targets, year })
}

function opts(partial: Partial<ResolveMangagoOptions> & { search: MangagoSearch }): ResolveMangagoOptions {
  return partial
}

describe("resolveMangagoUrl — casos documentados", () => {
  it("Solo Leveling: canônica vence spinoffs MESMO vindo em rank 4 (argmax)", async () => {
    // no set real, solo_leveling é o 4º candidato do backend.
    expect(SETS["Solo Leveling"].findIndex((c) => c.slug === "solo_leveling")).toBeGreaterThan(0)
    const r = await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling", "나 혼자만 레벨업"]),
      })
    )
    expect(r?.slug).toBe("solo_leveling")
    expect(r?.score).toBe(1)
    expect(r?.matchedKind).toBe("title")
    expect(r?.band).toBe("auto")
    expect(r?.margin).toBeGreaterThanOrEqual(0.08)
  })

  it("One Piece: one_piece vence one_piece_colored por title>otherTitle (ambos 1.0)", async () => {
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["One Piece"], ["One Piece"]) })
    )
    expect(r?.slug).toBe("one_piece")
    expect(r?.matchedKind).toBe("title")
    expect(r?.score).toBe(1)
    // margem 0 (colored também 1.0) → não é AUTO; fica em review (ver resumo).
    expect(r?.band).toBe("review")
  })

  it("Dr. Stone: dr_stone (exato) vence stone (reverse) e é AUTO", async () => {
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["Dr. Stone"], ["Dr. Stone"]) })
    )
    expect(r?.slug).toBe("dr_stone")
    expect(r?.band).toBe("auto")
  })

  it("reverse-substring risk NUNCA vira AUTO sozinho (só 'stone' no set)", async () => {
    const onlyStone = SETS["Dr. Stone"].filter((c) => c.slug === "stone")
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom({ "Dr. Stone": onlyStone }), buildVariants: fixedVariants(["Dr. Stone"], ["Dr. Stone"]) })
    )
    expect(r?.slug).toBe("stone")
    expect(r?.score).toBeCloseTo(0.9, 5)
    expect(r?.band).toBe("review") // 0.9 mas reverse-risk → nunca auto
  })

  it("Kaguya: split de subtítulo eleva o score p/ 1.0 (casa a linha romaji)", async () => {
    // O split é decisivo: sem ele o romaji casa ~0.375 (ver mangago-match.test);
    // com ele, 1.0. Fica em REVIEW (não AUTO) porque o Mangago tem uma entrada
    // DUPLICADA que compartilha o mesmo romaji → margem 0. Só ano/autor (E5/E6)
    // desempata. É o comportamento conservador correto, não uma falha do split.
    const r = await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Kaguya-sama wa Kokurasetai"], ["Kaguya-sama wa Kokurasetai"]),
      })
    )
    expect(r?.score).toBe(1)
    expect(r?.matchedKind).toBe("otherTitle")
    expect(r?.matchedTarget).toBe("Kaguya-sama wa Kokurasetai")
    expect(r?.matchedCandidateTitle).toContain("Kokurasetai")
    expect(r?.band).toBe("review")
    expect(r?.margin).toBe(0) // duplicata com o mesmo romaji
  })

  it("CJK: 呪術廻戦 casa o otherTitle espaçado do Mangago", async () => {
    // jujutsu_kaisen e jujutsu_kaisen_modulo compartilham o native "呪 術 廻 戦"
    // → ambos 1.0 → REVIEW (margem 0). Argmax estável mantém o rank-1 canônico.
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["呪術廻戦"], ["呪術廻戦"]) })
    )
    expect(r?.slug).toBe("jujutsu_kaisen")
    expect(r?.score).toBe(1)
    expect(r?.matchedKind).toBe("otherTitle")
    expect(r?.band).toBe("review")
  })

  it("CJK coreano: 나 혼자만 레벨업 casa e é AUTO", async () => {
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["나 혼자만 레벨업"], ["나 혼자만 레벨업"]) })
    )
    expect(r?.slug).toBe("solo_leveling")
    expect(r?.score).toBe(1)
    expect(r?.matchedKind).toBe("otherTitle")
    expect(r?.band).toBe("auto")
  })

  it("Kingdom: obra canônica ausente/baixa → null (falso negativo > falso positivo)", async () => {
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["Kingdom"], ["Kingdom"]) })
    )
    expect(r).toBeNull()
  })

  it("Monster: idem Kingdom → null", async () => {
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom(SETS), buildVariants: fixedVariants(["Monster"], ["Monster"]) })
    )
    expect(r).toBeNull()
  })
})

describe("resolveMangagoUrl — robustez", () => {
  it("falha de UMA query não derruba as outras", async () => {
    const search: MangagoSearch = async (q) => {
      if (q === "boom") throw new Error("search failed")
      return SETS["Solo Leveling"]
    }
    const r = await resolveMangagoUrl(
      {},
      opts({ search, buildVariants: fixedVariants(["boom", "Solo Leveling"], ["Solo Leveling"]) })
    )
    expect(r?.slug).toBe("solo_leveling")
  })

  it("todas as queries falham → null, sem throw", async () => {
    const search: MangagoSearch = async () => {
      throw new Error("down")
    }
    const r = await resolveMangagoUrl({}, opts({ search, buildVariants: fixedVariants(["a", "b"], ["Solo Leveling"]) }))
    expect(r).toBeNull()
  })

  it("sem variantes úteis → null e NÃO chama search", async () => {
    const search = vi.fn<MangagoSearch>(async () => [])
    const r = await resolveMangagoUrl({}, opts({ search, buildVariants: fixedVariants([], []) }))
    expect(r).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it("onResult recebe o evento (observabilidade preparada)", async () => {
    const events: unknown[] = []
    await resolveMangagoUrl(
      {},
      opts({
        search: searchFrom(SETS),
        buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]),
        now: () => 0,
        onResult: (e) => events.push(e),
      })
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ band: "auto", result: "resolved", slug: "solo_leveling" })
  })

  it("slug não entra no score (candidato com slug=alvo mas título alheio → null)", async () => {
    const bogus: MangagoSearchCandidate[] = [{ slug: "one_piece", title: "Totally Unrelated Work", otherTitles: [] }]
    const r = await resolveMangagoUrl(
      {},
      opts({ search: searchFrom({ "One Piece": bogus }), buildVariants: fixedVariants(["One Piece"], ["One Piece"]) })
    )
    expect(r).toBeNull()
  })
})
