import { describe, it, expect, vi } from "vitest"
import { ensureMangagoSlug, persistMangagoSlug } from "@/lib/external/mangago-persist"
import { mangagoWorkUrl } from "@/lib/external/mangago-resolve"
import type { MangagoResolved } from "@/lib/external/mangago-resolve"

// --- Supabase mock mínimo (select→eq→eq→maybeSingle + upsert) ---------------
function fakeSupabase(cfg: { row?: unknown; selectError?: string; upsertError?: string } = {}) {
  const upsert = vi.fn(async () => ({ error: cfg.upsertError ? { message: cfg.upsertError } : null }))
  const maybeSingle = vi.fn(async () => ({
    data: cfg.row ?? null,
    error: cfg.selectError ? { message: cfg.selectError } : null,
  }))
  const chain = { eq: vi.fn(() => chain), maybeSingle }
  const select = vi.fn(() => chain)
  const from = vi.fn(() => ({ upsert, select }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, from, upsert, select, maybeSingle }
}

const resolvedAuto = (slug = "solo_leveling", method = "exact"): MangagoResolved => ({
  slug,
  url: mangagoWorkUrl(slug),
  score: 1,
  margin: 0.3,
  method,
  band: "auto",
  matchedKind: "title",
  matchedTarget: "X",
  matchedCandidateTitle: "X",
  queryUsed: "X",
})
const resolvedReview = (slug = "one_piece"): MangagoResolved => ({ ...resolvedAuto(slug), band: "review", margin: 0 })

type EnsureParams = Parameters<typeof ensureMangagoSlug>[0]
const base = (over: Partial<EnsureParams> & Pick<EnsureParams, "supabase">): EnsureParams => ({
  workId: "w1",
  input: { title: "Solo Leveling" },
  resolve: vi.fn(async () => null as MangagoResolved | null),
  enabled: true,
  ...over,
})

// ============================================================================
// persistMangagoSlug
// ============================================================================
describe("persistMangagoSlug", () => {
  it("slug válido → upsert com source=mangago, ok:true", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await persistMangagoSlug({ supabase, workId: "w1", slug: "solo_leveling" })
    expect(r).toEqual({ ok: true, slug: "solo_leveling" })
    expect(upsert).toHaveBeenCalledWith(
      { work_id: "w1", source: "mangago", external_id: "solo_leveling" },
      { onConflict: "work_id,source" }
    )
  })
  it("aceita URL do Mangago e extrai o slug", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await persistMangagoSlug({ supabase, workId: "w1", slug: "https://www.mangago.me/read-manga/one_piece/" })
    expect(r.ok).toBe(true)
    expect(r.slug).toBe("one_piece")
    expect(upsert).toHaveBeenCalled()
  })
  it("slug inválido → não grava, ok:false", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await persistMangagoSlug({ supabase, workId: "w1", slug: "https://evil.com/read-manga/x/" })
    expect(r).toEqual({ ok: false, reason: "invalid_slug" })
    expect(upsert).not.toHaveBeenCalled()
  })
  it("erro do Supabase → ok:false, não propaga", async () => {
    const { supabase } = fakeSupabase({ upsertError: "boom" })
    const r = await persistMangagoSlug({ supabase, workId: "w1", slug: "solo_leveling" })
    expect(r).toMatchObject({ ok: false, reason: "db_error" })
  })
})

// ============================================================================
// ensureMangagoSlug
// ============================================================================
describe("ensureMangagoSlug", () => {
  it("1. disabled → não toca DB nem resolve", async () => {
    const { supabase, from } = fakeSupabase()
    const p = base({ supabase, enabled: false })
    const r = await ensureMangagoSlug(p)
    expect(r).toMatchObject({ reason: "disabled", slug: null, persisted: false })
    expect(from).not.toHaveBeenCalled()
    expect(p.resolve).not.toHaveBeenCalled()
  })

  it("2 & 15. já persistido → retorna slug/url, não chama resolve", async () => {
    const { supabase } = fakeSupabase({ row: { external_id: "solo_leveling", is_rejected: false } })
    const p = base({ supabase })
    const r = await ensureMangagoSlug(p)
    expect(r).toMatchObject({
      reason: "already_persisted",
      slug: "solo_leveling",
      url: "https://www.mangago.me/read-manga/solo_leveling/",
      persisted: true,
    })
    expect(p.resolve).not.toHaveBeenCalled()
  })

  it("3. slug persistido inválido → ignora e resolve", async () => {
    const { supabase } = fakeSupabase({ row: { external_id: "!!!bad!!!", is_rejected: false } })
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("resolved_auto")
  })

  it("4 & 13. sem persistido + resolve auto → persiste (source=mangago)", async () => {
    const { supabase, upsert } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => resolvedAuto("solo_leveling"))
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r).toMatchObject({ reason: "resolved_auto", slug: "solo_leveling", persisted: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "mangago", external_id: "solo_leveling" }),
      { onConflict: "work_id,source" }
    )
  })

  it("5. resolve year_confirmed → persiste, reason resolved_year_confirmed", async () => {
    const { supabase, upsert } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => resolvedAuto("jujutsu_kaisen", "year_confirmed"))
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r.reason).toBe("resolved_year_confirmed")
    expect(r.persisted).toBe(true)
    expect(upsert).toHaveBeenCalled()
  })

  it("6 & 14. resolve review → NÃO persiste, retorna o resultado", async () => {
    const { supabase, upsert } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => resolvedReview("one_piece"))
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r).toMatchObject({ reason: "resolved_review_not_persisted", slug: "one_piece", persisted: false })
    expect(r.resolved?.band).toBe("review")
    expect(upsert).not.toHaveBeenCalled()
  })

  it("7. resolve null → não persiste, reason no_match, slug null", async () => {
    const { supabase, upsert } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => null)
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r).toMatchObject({ reason: "no_match", slug: null, persisted: false })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("8. erro ao consultar persistido → fail-soft, degrada p/ resolve", async () => {
    const { supabase } = fakeSupabase({ selectError: "db is down" })
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("resolved_auto") // não lançou; resolveu e persistiu
  })

  it("9. erro ao persistir → não propaga; retorna o resolvido (persisted:false)", async () => {
    const { supabase } = fakeSupabase({ row: null, upsertError: "write failed" })
    const resolve = vi.fn(async () => resolvedAuto("solo_leveling"))
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r).toMatchObject({ reason: "persist_error", slug: "solo_leveling", persisted: false })
    expect(r.resolved?.slug).toBe("solo_leveling")
  })

  it("10. slug manual válido → persiste direto, não chama resolve", async () => {
    const { supabase, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => null)
    const r = await ensureMangagoSlug(
      base({ supabase, resolve, manualSlugOrUrl: "https://www.mangago.me/read-manga/solo_leveling/" })
    )
    expect(r).toMatchObject({ reason: "manual_slug", slug: "solo_leveling", persisted: true })
    expect(upsert).toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("11. slug manual inválido (sem outros dados) → não persiste direto", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureMangagoSlug(base({ supabase, input: {}, manualSlugOrUrl: "not a slug!!!" }))
    expect(r).toMatchObject({ reason: "invalid_manual_slug", persisted: false })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("12. URL manual de outro domínio → rejeita (não persiste)", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureMangagoSlug(
      base({ supabase, input: {}, manualSlugOrUrl: "https://evil.com/read-manga/solo_leveling/" })
    )
    expect(r.reason).toBe("invalid_manual_slug")
    expect(r.persisted).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("manual inválido MAS com título → cai pro resolvedor automático", async () => {
    const { supabase } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(
      base({ supabase, resolve, input: { title: "Solo Leveling" }, manualSlugOrUrl: "lixo com espaço" })
    )
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("resolved_auto")
  })

  it("16. linha persistida rejeitada (is_rejected) → bloqueia, não resolve", async () => {
    const { supabase } = fakeSupabase({ row: { external_id: "solo_leveling", is_rejected: true } })
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r).toMatchObject({ reason: "rejected", slug: null, persisted: false })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("workId ausente → fail-soft, não resolve", async () => {
    const { supabase, from } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve, workId: "" }))
    expect(r.reason).toBe("invalid_work_id")
    expect(from).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("resolve que lança → fail-soft, no_match, sem throw", async () => {
    const { supabase } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => {
      throw new Error("kaboom")
    })
    const r = await ensureMangagoSlug(base({ supabase, resolve }))
    expect(r.reason).toBe("no_match")
    expect(r.persisted).toBe(false)
  })
})

// ============================================================================
// E10B.3 — estado do DB fornecido pelo caller (sem 2ª leitura)
// ============================================================================
describe("ensureMangagoSlug — alreadyKnownSlug / rejected (E10B.3)", () => {
  it("1. rejected:true → reason rejected, sem select/resolve/upsert", async () => {
    const { supabase, select, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve, rejected: true }))
    expect(r).toMatchObject({ reason: "rejected", slug: null, persisted: false })
    expect(select).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("2. alreadyKnownSlug válido → already_persisted, sem select/resolve/upsert", async () => {
    const { supabase, select, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve, alreadyKnownSlug: "solo_leveling" }))
    expect(r).toMatchObject({
      reason: "already_persisted",
      slug: "solo_leveling",
      url: "https://www.mangago.me/read-manga/solo_leveling/",
      persisted: true,
    })
    expect(select).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("3. alreadyKnownSlug como URL do Mangago → extrai slug + URL canônica", async () => {
    const { supabase } = fakeSupabase()
    const r = await ensureMangagoSlug(
      base({ supabase, alreadyKnownSlug: "https://www.mangago.me/read-manga/one_piece/?x=1" })
    )
    expect(r.slug).toBe("one_piece")
    expect(r.url).toBe("https://www.mangago.me/read-manga/one_piece/")
    expect(r.reason).toBe("already_persisted")
  })

  it("4. alreadyKnownSlug inválido → ignora e resolve (sem ler DB)", async () => {
    const { supabase, select } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve, alreadyKnownSlug: "!!!bad!!!" }))
    expect(select).not.toHaveBeenCalled() // estado fornecido → não lê DB
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("resolved_auto")
  })

  it("5. alreadyKnownSlug de outro domínio → ignora, não persiste diretamente", async () => {
    const { supabase, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => null) // sem match → no_match
    const r = await ensureMangagoSlug(
      base({ supabase, resolve, alreadyKnownSlug: "https://evil.com/read-manga/solo_leveling/" })
    )
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("no_match")
    expect(upsert).not.toHaveBeenCalled() // slug de outro domínio não é persistido
  })

  it("6. sem alreadyKnownSlug nem rejected → E9 preservado (consulta DB)", async () => {
    const { supabase, select, maybeSingle } = fakeSupabase({ row: null })
    const resolve = vi.fn(async () => resolvedAuto())
    await ensureMangagoSlug(base({ supabase, resolve }))
    expect(select).toHaveBeenCalled()
    expect(maybeSingle).toHaveBeenCalled()
  })

  it("7. manualSlugOrUrl válido tem precedência sobre rejected:true", async () => {
    const { supabase, select, upsert } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(
      base({
        supabase,
        resolve,
        rejected: true,
        manualSlugOrUrl: "https://www.mangago.me/read-manga/solo_leveling/",
      })
    )
    expect(r).toMatchObject({ reason: "manual_slug", slug: "solo_leveling", persisted: true })
    expect(upsert).toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("8. rejected:true tem precedência sobre alreadyKnownSlug", async () => {
    const { supabase } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(
      base({ supabase, resolve, rejected: true, alreadyKnownSlug: "solo_leveling" })
    )
    expect(r.reason).toBe("rejected")
    expect(r.slug).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("rejected:false explícito (sem known) → pula DB e resolve", async () => {
    const { supabase, select } = fakeSupabase()
    const resolve = vi.fn(async () => resolvedAuto())
    const r = await ensureMangagoSlug(base({ supabase, resolve, rejected: false }))
    expect(select).not.toHaveBeenCalled() // estado fornecido (rejected definido)
    expect(resolve).toHaveBeenCalled()
    expect(r.reason).toBe("resolved_auto")
  })
})
