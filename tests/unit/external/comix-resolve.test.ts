import { describe, expect, it, vi } from "vitest"
import {
  matchComixCandidate,
  cacheKey,
  ComixResolveCache,
  resolveComixUrl,
  comixCreateResolveInput,
} from "@/lib/external/comix-resolve"
import type {
  ComixSidecarItem,
  ComixSidecarResponse,
  ComixRenderClient,
  ComixResolveInput,
} from "@/lib/external/comix-resolve"
import fixture from "@/tests/fixtures/comix-render/browse-relevance-i-adopted.json"

const ITEMS = fixture.items as ComixSidecarItem[]
const TARGET = { hid: "3ezr0", url: "https://comix.to/title/3ezr0-i-adopted-the-protagonist-and-the-genre-changed" }

/** Cliente de sidecar fake, configurável, com contador de chamadas. */
function fakeClient(resp: ComixSidecarResponse): ComixRenderClient & { calls: number } {
  return {
    calls: 0,
    async resolve() {
      this.calls++
      return resp
    },
  }
}

const okResp = (items: ComixSidecarItem[]): ComixSidecarResponse => ({
  ok: true,
  items,
  meta: { query: "q", elapsedMs: 10, totalCandidates: items.length, source: "test" },
})

describe("matchComixCandidate — precedência de cross-ID", () => {
  it("casa por AniList ID (retorna hid + url absoluta)", () => {
    const m = matchComixCandidate(ITEMS, { title: "qualquer coisa", anilistId: 200573 })
    expect(m?.method).toBe("anilist")
    expect(m?.resolved).toEqual(TARGET)
  })

  it("casa por MAL ID", () => {
    const m = matchComixCandidate(ITEMS, { title: "qualquer", malId: 191605 })
    expect(m?.method).toBe("mal")
    expect(m?.resolved.hid).toBe("3ezr0")
  })

  it("casa por MangaUpdates ID (case-insensitive)", () => {
    const m = matchComixCandidate(ITEMS, { title: "qualquer", mangaUpdatesId: "IWQX86G" })
    expect(m?.method).toBe("mangaupdates")
    expect(m?.resolved.hid).toBe("3ezr0")
  })

  it("AniList vence MAL quando ambos apontam obras diferentes (ordem determinística)", () => {
    // anilistId aponta a obra #2 (390yn); malId aponta a #1 (3ezr0).
    // Precedência: AniList primeiro → 390yn.
    const m = matchComixCandidate(ITEMS, { title: "x", anilistId: 133038, malId: 191605 })
    expect(m?.method).toBe("anilist")
    expect(m?.resolved.hid).toBe("390yn")
  })

  it("ignora cross-ID que não existe em nenhum candidato e cai pro título (com fallback)", () => {
    // anilistId inexistente; com allowTitleFallback → cai pro título (casa exato).
    const m = matchComixCandidate(
      ITEMS,
      { title: "I Adopted the Protagonist, and the Genre Changed", anilistId: 999999 },
      true,
    )
    expect(m?.method).toBe("title")
    expect(m?.resolved.hid).toBe("3ezr0")
  })
})

describe("matchComixCandidate — gate do fallback por título", () => {
  it("SEM allowTitleFallback (default) NÃO casa por título — mesmo com título exato", () => {
    const m = matchComixCandidate(ITEMS, { title: "I Adopted the Protagonist, and the Genre Changed" })
    expect(m).toBeNull()
  })

  it("COM allowTitleFallback casa título exato quando não há cross-ID", () => {
    const m = matchComixCandidate(ITEMS, { title: "I Adopted the Protagonist, and the Genre Changed" }, true)
    expect(m?.method).toBe("title")
    expect(m?.resolved.hid).toBe("3ezr0")
  })

  it("cross-ID sempre casa, independente do gate (fallback false)", () => {
    const m = matchComixCandidate(ITEMS, { title: "x", anilistId: 200573 }, false)
    expect(m?.method).toBe("anilist")
    expect(m?.resolved.hid).toBe("3ezr0")
  })

  it("COM allowTitleFallback rejeita (null) quando o melhor título fica abaixo de 0.72", () => {
    const m = matchComixCandidate(ITEMS, { title: "um título completamente diferente xyz" }, true)
    expect(m).toBeNull()
  })

  it("retorna null em lista vazia", () => {
    expect(matchComixCandidate([], { title: "qualquer", anilistId: 200573 })).toBeNull()
  })

  it("trata links ausentes/null sem quebrar", () => {
    const items: ComixSidecarItem[] = [
      { hid: "aaa", url: "/title/aaa-x", title: "X", links: undefined },
      { hid: "bbb", url: "/title/bbb-y", title: "Y", links: { al: null, mal: null } },
    ]
    expect(matchComixCandidate(items, { title: "Z", anilistId: 200573 })).toBeNull()
  })
})

describe("cacheKey — precedência", () => {
  it("prefere AniList → MAL → MU → título", () => {
    expect(cacheKey({ title: "t", anilistId: 1, malId: 2, mangaUpdatesId: "m" })).toBe("al:1")
    expect(cacheKey({ title: "t", malId: 2, mangaUpdatesId: "m" })).toBe("mal:2")
    expect(cacheKey({ title: "t", mangaUpdatesId: "MiXeD" })).toBe("mu:mixed")
    expect(cacheKey({ title: "  Sévéràl  Wörds! " })).toBe("t:several words")
  })
})

describe("ComixResolveCache — LRU + TTL + negativo", () => {
  it("hit dentro do TTL, expira depois", () => {
    const c = new ComixResolveCache()
    c.set("k", TARGET, 1000)
    expect(c.get("k", 1000)?.value).toEqual(TARGET)
    // TTL hit = 24h; ainda vivo em +1h, morto em +25h
    expect(c.get("k", 1000 + 60 * 60_000)?.value).toEqual(TARGET)
    expect(c.get("k", 1000 + 25 * 60 * 60_000)).toBeUndefined()
  })

  it("cacheia negativo (null) com TTL menor", () => {
    const c = new ComixResolveCache()
    c.set("k", null, 0)
    // TTL miss = 6h: vivo em +5h, morto em +7h
    expect(c.get("k", 5 * 60 * 60_000)?.value).toBeNull()
    expect(c.get("k", 7 * 60 * 60_000)).toBeUndefined()
  })

  it("evicta o mais antigo ao passar da capacidade", () => {
    const c = new ComixResolveCache(2)
    c.set("a", TARGET, 0)
    c.set("b", TARGET, 0)
    c.set("c", TARGET, 0) // evicta "a"
    expect(c.get("a", 1)).toBeUndefined()
    expect(c.get("b", 1)?.value).toEqual(TARGET)
    expect(c.get("c", 1)?.value).toEqual(TARGET)
  })

  it("get renova a ordem LRU (acesso protege da evicção)", () => {
    const c = new ComixResolveCache(2)
    c.set("a", TARGET, 0)
    c.set("b", TARGET, 0)
    c.get("a", 1) // toca "a" → "b" vira o mais antigo
    c.set("c", TARGET, 0) // evicta "b"
    expect(c.get("a", 2)?.value).toEqual(TARGET)
    expect(c.get("b", 2)).toBeUndefined()
  })
})

describe("resolveComixUrl — orquestração", () => {
  const input: ComixResolveInput = { title: "I Adopted the Protagonist, and the Genre Changed", anilistId: 200573 }

  it("resolve via sidecar e casa por cross-ID", async () => {
    const client = fakeClient(okResp(ITEMS))
    const cache = new ComixResolveCache()
    const r = await resolveComixUrl(input, { client, cache, now: () => 0 })
    expect(r).toEqual(TARGET)
    expect(client.calls).toBe(1)
  })

  it("segundo call idêntico vem do cache (não chama o sidecar)", async () => {
    const client = fakeClient(okResp(ITEMS))
    const cache = new ComixResolveCache()
    await resolveComixUrl(input, { client, cache, now: () => 0 })
    const r2 = await resolveComixUrl(input, { client, cache, now: () => 60_000 })
    expect(r2).toEqual(TARGET)
    expect(client.calls).toBe(1) // ainda 1 → cache hit
  })

  it("cacheia negativo: sem match não re-chama dentro do TTL", async () => {
    const client = fakeClient(okResp(ITEMS))
    const cache = new ComixResolveCache()
    const miss: ComixResolveInput = { title: "obra que não existe zzz" }
    const r1 = await resolveComixUrl(miss, { client, cache, now: () => 0 })
    const r2 = await resolveComixUrl(miss, { client, cache, now: () => 1000 })
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(client.calls).toBe(1)
  })

  it("erro do sidecar → null e NÃO é cacheado (re-tenta no próximo call)", async () => {
    const client = fakeClient({ ok: false, error: "render_timeout", meta: { elapsedMs: 8000, source: "x" } })
    const cache = new ComixResolveCache()
    const r1 = await resolveComixUrl(input, { client, cache, now: () => 0 })
    const r2 = await resolveComixUrl(input, { client, cache, now: () => 1000 })
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(client.calls).toBe(2) // erro não cacheado → chamou de novo
  })

  it("título vazio → null sem tocar o sidecar", async () => {
    const client = fakeClient(okResp(ITEMS))
    const r = await resolveComixUrl({ title: "   " }, { client, cache: new ComixResolveCache() })
    expect(r).toBeNull()
    expect(client.calls).toBe(0)
  })

  it("gate: título-só resolve só com allowTitleFallback", async () => {
    const titleOnly: ComixResolveInput = { title: "I Adopted the Protagonist, and the Genre Changed" }
    const off = fakeClient(okResp(ITEMS))
    // default (false) → sem match por título (mesmo o sidecar devolvendo candidatos)
    expect(await resolveComixUrl(titleOnly, { client: off, cache: new ComixResolveCache(), now: () => 0 })).toBeNull()
    // true → casa por título
    const on = fakeClient(okResp(ITEMS))
    const r = await resolveComixUrl(
      { ...titleOnly, allowTitleFallback: true },
      { client: on, cache: new ComixResolveCache(), now: () => 0 },
    )
    expect(r).toEqual(TARGET)
  })

  it("invoca onResult com outcome/method/cache", async () => {
    const client = fakeClient(okResp(ITEMS))
    const cache = new ComixResolveCache()
    const onResult = vi.fn()
    await resolveComixUrl(input, { client, cache, now: () => 0, onResult })
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ method: "anilist", cache: "miss", resolved: true, outcome: "resolved" }),
    )
    await resolveComixUrl(input, { client, cache, now: () => 0, onResult })
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ cache: "hit", resolved: true, outcome: "cache_hit" }))
  })
})

describe("comixCreateResolveInput — gate injeta-antes-de-buscar (create)", () => {
  it("já tem hid do comix → null (nada a resolver)", () => {
    expect(comixCreateResolveInput("T", { comix: "3ezr0", anilist: "200573" })).toBeNull()
  })

  it("sem nenhum cross-ID → null (não arrisca match por título no create)", () => {
    expect(comixCreateResolveInput("T", {})).toBeNull()
    expect(comixCreateResolveInput("T", { kitsu: "abc", mangadex: "xyz" })).toBeNull()
  })

  it("com AniList ID → input com anilistId e allowTitleFallback:false", () => {
    expect(comixCreateResolveInput("Título", { anilist: "200573" })).toEqual({
      title: "Título",
      anilistId: 200573,
      malId: undefined,
      mangaUpdatesId: undefined,
      allowTitleFallback: false,
    })
  })

  it("mistura os cross-IDs presentes (mal numérico, mangaupdates slug)", () => {
    expect(comixCreateResolveInput("T", { myanimelist: "157823", mangaupdates: "0bvjowf" })).toEqual({
      title: "T",
      anilistId: undefined,
      malId: 157823,
      mangaUpdatesId: "0bvjowf",
      allowTitleFallback: false,
    })
  })

  it("id numérico inválido (0/negativo/vazio) é ignorado", () => {
    expect(comixCreateResolveInput("T", { anilist: "0", myanimelist: "-3" })).toBeNull()
    expect(comixCreateResolveInput("T", { anilist: "", mangaupdates: "" })).toBeNull()
  })
})
