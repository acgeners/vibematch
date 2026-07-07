import { describe, expect, it, vi } from "vitest"
import {
  buildMangagoResolveCacheKey,
  MangagoMemoryResolveCache,
  DEFAULT_CACHE_CONFIG,
  readCacheConfigFromEnv,
} from "@/lib/external/mangago-cache"
import type { MangagoCacheConfig } from "@/lib/external/mangago-cache"
import { resolveMangagoUrl } from "@/lib/external/mangago-resolve"
import type {
  MangagoResolved,
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

const sample = (slug: string): MangagoResolved => ({
  slug,
  url: `https://www.mangago.me/read-manga/${slug}/`,
  score: 1,
  margin: 0.3,
  method: "exact",
  band: "auto",
  matchedKind: "title",
  matchedTarget: "X",
  matchedCandidateTitle: "X",
  queryUsed: "X",
})

const smallCfg = (over: Partial<MangagoCacheConfig> = {}): MangagoCacheConfig => ({
  hitTtlMs: 1_000_000,
  missTtlMs: 1_000_000,
  maxEntries: 1000,
  ...over,
})

// ============================================================================
// Cache puro
// ============================================================================

describe("buildMangagoResolveCacheKey", () => {
  it("1. anilistId → al:<id>", () => {
    expect(buildMangagoResolveCacheKey({ anilistId: 5 })).toBe("al:5")
  })
  it("2. precedência al > mal > mu > title", () => {
    expect(buildMangagoResolveCacheKey({ anilistId: 1, malId: 2, mangaUpdatesId: "3", title: "x" })).toBe("al:1")
    expect(buildMangagoResolveCacheKey({ malId: 2, mangaUpdatesId: "3", title: "x" })).toBe("mal:2")
    expect(buildMangagoResolveCacheKey({ mangaUpdatesId: "3", title: "x" })).toBe("mu:3")
    expect(buildMangagoResolveCacheKey({ title: "X" })).toBe("t:x")
  })
  it("3. title normalizado → mesma chave para variações de caixa/espaço", () => {
    expect(buildMangagoResolveCacheKey({ title: "Solo Leveling" })).toBe(
      buildMangagoResolveCacheKey({ title: "  solo   leveling " })
    )
  })
  it("4. sem identidade útil → null", () => {
    expect(buildMangagoResolveCacheKey({})).toBeNull()
    expect(buildMangagoResolveCacheKey({ title: "   " })).toBeNull()
  })
})

describe("MangagoMemoryResolveCache", () => {
  it("5. get miss → undefined", () => {
    const c = new MangagoMemoryResolveCache(smallCfg())
    expect(c.get("k", 0)).toBeUndefined()
  })
  it("6. set positivo + get → objeto", () => {
    const c = new MangagoMemoryResolveCache(smallCfg())
    c.set("k", sample("solo"), 0)
    expect(c.get("k", 0)?.slug).toBe("solo")
  })
  it("7. set null + get → null (negative hit)", () => {
    const c = new MangagoMemoryResolveCache(smallCfg())
    c.set("k", null, 0)
    expect(c.get("k", 0)).toBeNull()
  })
  it("8. TTL positivo expira", () => {
    const c = new MangagoMemoryResolveCache(smallCfg({ hitTtlMs: 100 }))
    c.set("k", sample("s"), 0)
    expect(c.get("k", 99)?.slug).toBe("s")
    expect(c.get("k", 100)).toBeUndefined() // expirou
  })
  it("9. TTL negativo expira", () => {
    const c = new MangagoMemoryResolveCache(smallCfg({ missTtlMs: 50 }))
    c.set("k", null, 0)
    expect(c.get("k", 49)).toBeNull()
    expect(c.get("k", 50)).toBeUndefined()
  })
  it("10. get renova LRU", () => {
    const c = new MangagoMemoryResolveCache(smallCfg({ maxEntries: 2 }))
    c.set("a", sample("a"), 0)
    c.set("b", sample("b"), 0)
    c.get("a", 0) // renova 'a' → 'b' vira o mais antigo
    c.set("c", sample("c"), 0) // evicta 'b'
    expect(c.get("b", 0)).toBeUndefined()
    expect(c.get("a", 0)?.slug).toBe("a")
    expect(c.get("c", 0)?.slug).toBe("c")
  })
  it("11. maxEntries evicta o menos recentemente usado", () => {
    const c = new MangagoMemoryResolveCache(smallCfg({ maxEntries: 2 }))
    c.set("a", sample("a"), 0)
    c.set("b", sample("b"), 0)
    c.set("c", sample("c"), 0)
    expect(c.get("a", 0)).toBeUndefined()
    expect(c.get("b", 0)?.slug).toBe("b")
    expect(c.get("c", 0)?.slug).toBe("c")
    expect(c.size).toBe(2)
  })
})

describe("readCacheConfigFromEnv", () => {
  it("sem env → defaults", () => {
    expect(readCacheConfigFromEnv({})).toEqual(DEFAULT_CACHE_CONFIG)
  })
  it("válidas → parseadas", () => {
    const cfg = readCacheConfigFromEnv({ MANGAGO_RESOLVE_TTL_HIT_MS: "1000", MANGAGO_RESOLVE_CACHE_MAX: "5" })
    expect(cfg).toEqual({ hitTtlMs: 1000, missTtlMs: DEFAULT_CACHE_CONFIG.missTtlMs, maxEntries: 5 })
  })
  it("12. inválida/NaN/Infinity/negativa/não-inteira → defaults seguros", () => {
    const cfg = readCacheConfigFromEnv({
      MANGAGO_RESOLVE_TTL_HIT_MS: "abc",
      MANGAGO_RESOLVE_TTL_MISS_MS: "-1",
      MANGAGO_RESOLVE_CACHE_MAX: "0",
    })
    expect(cfg).toEqual(DEFAULT_CACHE_CONFIG)
    expect(readCacheConfigFromEnv({ MANGAGO_RESOLVE_TTL_HIT_MS: "Infinity" }).hitTtlMs).toBe(DEFAULT_CACHE_CONFIG.hitTtlMs)
    expect(readCacheConfigFromEnv({ MANGAGO_RESOLVE_CACHE_MAX: "1000.5" }).maxEntries).toBe(DEFAULT_CACHE_CONFIG.maxEntries)
  })
})

// ============================================================================
// Integração no resolvedor
// ============================================================================

function capture(partial: Partial<ResolveMangagoOptions> & { search: MangagoSearch }) {
  const events: MangagoResolveEvent[] = []
  const opts: ResolveMangagoOptions = { ...partial, onResult: (e) => events.push(e) }
  return { events, opts }
}

describe("E8 — integração cache no resolveMangagoUrl", () => {
  it("13. cache hit positivo → não chama search, retorna cacheado, evento cache:hit", async () => {
    const cache = new MangagoMemoryResolveCache()
    cache.set("t:solo leveling", sample("solo_leveling"), 0)
    const search = vi.fn<MangagoSearch>(async () => [])
    const { events, opts } = capture({ search, cache, now: () => 0 })
    const r = await resolveMangagoUrl({ title: "Solo Leveling" }, opts)
    expect(r?.slug).toBe("solo_leveling")
    expect(search).not.toHaveBeenCalled()
    expect(events[0]).toMatchObject({ result: "auto", cache: "hit", slug: "solo_leveling", queriesRun: 0, candidates: 0 })
  })

  it("14. cache hit negativo → não chama search, retorna null, evento cache:hit result:reject", async () => {
    const cache = new MangagoMemoryResolveCache()
    cache.set("t:solo leveling", null, 0)
    const search = vi.fn<MangagoSearch>(async () => [])
    const { events, opts } = capture({ search, cache, now: () => 0 })
    const r = await resolveMangagoUrl({ title: "Solo Leveling" }, opts)
    expect(r).toBeNull()
    expect(search).not.toHaveBeenCalled()
    expect(events[0]).toMatchObject({ result: "reject", cache: "hit" })
  })

  it("15. cache miss → chama search e popula o cache; 2ª chamada é hit", async () => {
    const cache = new MangagoMemoryResolveCache()
    const search = vi.fn(searchFrom(SETS))
    const base = { search, cache, buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]), now: () => 0 }
    const { events, opts } = capture(base)
    const r1 = await resolveMangagoUrl({ title: "Solo Leveling" }, opts)
    expect(r1?.slug).toBe("solo_leveling")
    expect(events[0].cache).toBe("miss")
    expect(cache.get("t:solo leveling", 0)?.slug).toBe("solo_leveling")
    // 2ª chamada: hit, sem nova busca
    const calls = search.mock.calls.length
    const r2 = await resolveMangagoUrl({ title: "Solo Leveling" }, { ...base })
    expect(r2?.slug).toBe("solo_leveling")
    expect(search.mock.calls.length).toBe(calls) // não buscou de novo
  })

  it("16. reject e no_candidates cacheiam null", async () => {
    const cache = new MangagoMemoryResolveCache()
    // reject (Kingdom, todos < 0.72)
    await resolveMangagoUrl(
      { title: "Kingdom" },
      { search: searchFrom(SETS), cache, buildVariants: fixedVariants(["Kingdom"], ["Kingdom"]), now: () => 0 }
    )
    expect(cache.get("t:kingdom", 0)).toBeNull()
    // no_candidates (busca vazia)
    await resolveMangagoUrl(
      { title: "Nadinha" },
      { search: async () => [], cache, buildVariants: fixedVariants(["Nadinha"], ["Nadinha"]), now: () => 0 }
    )
    expect(cache.get("t:nadinha", 0)).toBeNull()
  })

  it("17. search_failed e error NÃO cacheiam", async () => {
    const cache = new MangagoMemoryResolveCache()
    // search_failed
    await resolveMangagoUrl(
      { title: "Falha" },
      {
        search: async () => {
          throw new Error("down")
        },
        cache,
        buildVariants: fixedVariants(["a", "b"], ["Falha"]),
        now: () => 0,
      }
    )
    expect(cache.get("t:falha", 0)).toBeUndefined()
    // error (buildVariants lança)
    await resolveMangagoUrl(
      { title: "Erro" },
      {
        search: searchFrom(SETS),
        cache,
        buildVariants: async () => {
          throw new Error("boom")
        },
        now: () => 0,
      }
    )
    expect(cache.get("t:erro", 0)).toBeUndefined()
  })

  it("18. sem opts.cache → retorno idêntico ao E7 + evento cache:skip", async () => {
    const base = { search: searchFrom(SETS), buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]) }
    const { events, opts } = capture(base)
    const r = await resolveMangagoUrl({ title: "Solo Leveling" }, opts)
    expect(r).toMatchObject({ slug: "solo_leveling", band: "auto", score: 1 })
    expect(events[0].cache).toBe("skip")
  })

  it("19. sem chave de cache (input sem identidade) → cache:skip mesmo com opts.cache", async () => {
    const cache = new MangagoMemoryResolveCache()
    const { events, opts } = capture({
      search: searchFrom(SETS),
      cache,
      buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]),
    })
    const r = await resolveMangagoUrl({}, opts) // sem title/ids → sem chave
    expect(r?.slug).toBe("solo_leveling")
    expect(events[0].cache).toBe("skip")
    expect(cache.size).toBe(0) // nada cacheado sem chave
  })

  it("20. elapsedMs determinístico com opts.now (cache não adiciona chamadas)", async () => {
    let t = 1000
    const now = () => {
      const v = t
      t += 500
      return v
    }
    const cache = new MangagoMemoryResolveCache()
    const { events, opts } = capture({
      search: searchFrom(SETS),
      cache,
      buildVariants: fixedVariants(["Solo Leveling"], ["Solo Leveling"]),
      now,
    })
    await resolveMangagoUrl({ title: "Solo Leveling" }, opts)
    expect(events[0].elapsedMs).toBe(500) // started=1000, emit=1500
  })
})
