import { describe, it, expect, vi, beforeEach } from "vitest"

// Correção 2B.2 — getDeclaredTagPreferences escolhe o loader de tags por CONTEXTO:
// headless ⇒ getAllTagsUncached (sem unstable_cache, que lança headless);
// runtime Next ⇒ getAllTags (cacheado). Mocks isolados a este arquivo.

const h = vi.hoisted(() => ({
  cached: vi.fn(async () => [] as unknown[]),
  uncached: vi.fn(async () => [] as unknown[]),
}))

vi.mock("@/server/queries/tags", () => ({ getAllTags: h.cached, getAllTagsUncached: h.uncached }))
vi.mock("@/server/queries/current-user", () => ({ getCurrentUserId: vi.fn(async () => "u1") }))
vi.mock("@/lib/supabase/admin", () => {
  const b: Record<string, (...a: unknown[]) => unknown> = {}
  for (const m of ["from", "select"]) b[m] = () => b
  b.eq = () => Promise.resolve({ data: [], error: null })
  return { createAdminClient: () => b }
})

import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"

beforeEach(() => {
  h.cached.mockClear()
  h.uncached.mockClear()
})

describe("getDeclaredTagPreferences — loader de tags por contexto (headless-safe)", () => {
  it("headless:true ⇒ usa getAllTagsUncached, NUNCA getAllTags (unstable_cache)", async () => {
    const out = await getDeclaredTagPreferences(undefined, { headless: true })
    expect(out).toEqual([])
    expect(h.uncached).toHaveBeenCalledTimes(1)
    expect(h.cached).not.toHaveBeenCalled()
  })

  it("default (runtime Next) ⇒ usa getAllTags (cacheado)", async () => {
    await getDeclaredTagPreferences()
    expect(h.cached).toHaveBeenCalledTimes(1)
    expect(h.uncached).not.toHaveBeenCalled()
  })
})
