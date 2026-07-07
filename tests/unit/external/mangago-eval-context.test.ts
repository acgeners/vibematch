import { describe, it, expect, vi } from "vitest"
import { resolveMangagoForEvalContext } from "@/lib/external/mangago-eval-context"
import type { MangagoEvalContextParams } from "@/lib/external/mangago-eval-context"
import type { MangagoResolved } from "@/lib/external/mangago-resolve"
import type { ExternalSourceId } from "@/lib/external/types"

// Supabase mockado (upsert p/ persistir; select não deve ser chamado pois o
// helper sempre fornece rejected/alreadyKnownSlug → ensure pula o DB).
function fakeSupabase(cfg: { upsertError?: string } = {}) {
  const upsert = vi.fn(async () => ({ error: cfg.upsertError ? { message: cfg.upsertError } : null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const chain = { eq: vi.fn(() => chain), maybeSingle }
  const select = vi.fn(() => chain)
  const from = vi.fn(() => ({ upsert, select }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, from, upsert, select }
}

const resolved = (band: MangagoResolved["band"], method = "exact", slug = "solo_leveling"): MangagoResolved => ({
  slug,
  url: `https://www.mangago.me/read-manga/${slug}/`,
  score: 1,
  margin: 0.3,
  method,
  band,
  matchedKind: "title",
  matchedTarget: "X",
  matchedCandidateTitle: "X",
  queryUsed: "X",
})

function params(over: Partial<MangagoEvalContextParams> = {}): MangagoEvalContextParams {
  const { supabase } = fakeSupabase()
  return {
    supabase,
    workId: "w1",
    identity: { title: "Solo Leveling" },
    acceptedExternalIds: {} as Partial<Record<ExternalSourceId, string>>,
    rejectedSources: [],
    enabled: true,
    resolve: vi.fn(async () => null),
    ...over,
  }
}

describe("resolveMangagoForEvalContext", () => {
  it("1 & 10 & 12. enabled=false → não resolve, não injeta", async () => {
    const resolve = vi.fn(async () => resolved("auto"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    await resolveMangagoForEvalContext(params({ enabled: false, resolve, acceptedExternalIds: ext }))
    expect(resolve).not.toHaveBeenCalled()
    expect(ext.mangago).toBeUndefined()
  })

  it("2. slug já aceito → already_persisted, injeta, não resolve", async () => {
    const resolve = vi.fn(async () => resolved("auto", "exact", "outro"))
    const ext: Partial<Record<ExternalSourceId, string>> = { mangago: "solo_leveling" }
    const r = await resolveMangagoForEvalContext(params({ resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("already_persisted")
    expect(resolve).not.toHaveBeenCalled()
    expect(ext.mangago).toBe("solo_leveling")
  })

  it("3. fonte rejeitada → não resolve, não injeta", async () => {
    const resolve = vi.fn(async () => resolved("auto"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(
      params({ resolve, acceptedExternalIds: ext, rejectedSources: ["mangago"] })
    )
    expect(r?.reason).toBe("rejected")
    expect(resolve).not.toHaveBeenCalled()
    expect(ext.mangago).toBeUndefined()
  })

  it("4. resolve auto → resolve chamado, persiste e injeta", async () => {
    const { supabase, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => resolved("auto", "exact", "solo_leveling"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ supabase, resolve, acceptedExternalIds: ext }))
    expect(resolve).toHaveBeenCalled()
    expect(r?.reason).toBe("resolved_auto")
    expect(upsert).toHaveBeenCalled()
    expect(ext.mangago).toBe("solo_leveling")
  })

  it("5. resolve year_confirmed → injeta", async () => {
    const resolve = vi.fn(async () => resolved("auto", "year_confirmed", "jujutsu_kaisen"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("resolved_year_confirmed")
    expect(ext.mangago).toBe("jujutsu_kaisen")
  })

  it("6. resolve review → NÃO injeta", async () => {
    const resolve = vi.fn(async () => resolved("review", "exact", "one_piece"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("resolved_review_not_persisted")
    expect(ext.mangago).toBeUndefined()
  })

  it("7. resolve null/no_match → NÃO injeta", async () => {
    const resolve = vi.fn(async () => null)
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("no_match")
    expect(ext.mangago).toBeUndefined()
  })

  it("8a. resolve que lança → sem throw, não injeta (ensure degrada p/ no_match)", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("flaresolverr down")
    })
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("no_match")
    expect(ext.mangago).toBeUndefined()
  })

  it("8b. ensure que lança → fail-soft do helper (retorna null, não injeta)", async () => {
    const ensure = vi.fn(async () => {
      throw new Error("boom")
    })
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ ensure, acceptedExternalIds: ext }))
    expect(r).toBeNull()
    expect(ext.mangago).toBeUndefined()
  })

  it("9. input passa title + anilistId/malId/mangaUpdatesId corretos", async () => {
    const resolve = vi.fn(async () => null)
    await resolveMangagoForEvalContext(
      params({
        resolve,
        identity: { title: "Solo Leveling" },
        acceptedExternalIds: { anilist: "123", myanimelist: "456", mangaupdates: "789" },
      })
    )
    expect(resolve).toHaveBeenCalledWith({
      title: "Solo Leveling",
      anilistId: 123,
      malId: 456,
      mangaUpdatesId: "789",
    })
  })

  it("persist_error (auto mas upsert falhou) → NÃO injeta (conservador)", async () => {
    const { supabase } = fakeSupabase({ upsertError: "write failed" })
    const resolve = vi.fn(async () => resolved("auto", "exact", "solo_leveling"))
    const ext: Partial<Record<ExternalSourceId, string>> = {}
    const r = await resolveMangagoForEvalContext(params({ supabase, resolve, acceptedExternalIds: ext }))
    expect(r?.reason).toBe("persist_error")
    expect(ext.mangago).toBeUndefined()
  })
})
