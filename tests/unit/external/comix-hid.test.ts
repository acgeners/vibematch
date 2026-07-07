import { describe, it, expect, beforeEach, vi } from "vitest"
import { ensureComixHid, persistComixHid } from "@/server/actions/comix-hid"
import { resolveComixUrl } from "@/lib/external/comix-resolve"
import { isComixRenderConfigured } from "@/lib/external/comix-render-client"

vi.mock("@/lib/external/comix-resolve", () => ({ resolveComixUrl: vi.fn() }))
vi.mock("@/lib/external/comix-render-client", () => ({ isComixRenderConfigured: vi.fn(() => true) }))

const mockResolve = vi.mocked(resolveComixUrl)
const mockConfigured = vi.mocked(isComixRenderConfigured)

function fakeSupabase() {
  const upsert = vi.fn(async () => ({ error: null }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = { from: vi.fn(() => ({ upsert })) } as any
  return { supabase, upsert }
}

const baseParams = () => ({
  workId: "w1",
  title: "Some Title",
  alreadyKnownHid: null as string | null,
  comixRejected: false,
  crossIds: { anilistId: 200573 } as { anilistId?: number; malId?: number; mangaUpdatesId?: string },
})

beforeEach(() => {
  mockResolve.mockReset()
  mockConfigured.mockReset()
  mockConfigured.mockReturnValue(true)
})

describe("ensureComixHid — skips (sem tocar o sidecar)", () => {
  it("already_persisted: devolve o hid conhecido, não resolve nem persiste", async () => {
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase, alreadyKnownHid: "abc" })
    expect(r).toBe("abc")
    expect(mockResolve).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("rejected: devolve null e não resolve", async () => {
    const { supabase } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase, comixRejected: true })
    expect(r).toBeNull()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it("no_cross_id: sem anilist/mal/mu → null, não resolve", async () => {
    const { supabase } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase, crossIds: {} })
    expect(r).toBeNull()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it("sidecar_disabled: COMIX_RENDER_URL ausente → null, não resolve", async () => {
    mockConfigured.mockReturnValue(false)
    const { supabase } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase })
    expect(r).toBeNull()
    expect(mockResolve).not.toHaveBeenCalled()
  })
})

describe("ensureComixHid — resolução", () => {
  it("resolve por cross-ID → persiste e devolve o hid; chama resolveComixUrl com allowTitleFallback=false", async () => {
    mockResolve.mockImplementation(async (_input, opts) => {
      opts?.onResult?.({ method: "anilist", cache: "miss", resolved: true, outcome: "resolved" })
      return { hid: "3ezr0", url: "https://comix.to/title/3ezr0-x" }
    })
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureComixHid({
      ...baseParams(),
      supabase,
      crossIds: { anilistId: 200573, mangaUpdatesId: "iwqx86g" },
    })
    expect(r).toBe("3ezr0")
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Some Title", anilistId: 200573, mangaUpdatesId: "iwqx86g", allowTitleFallback: false }),
      expect.anything(),
    )
    expect(upsert).toHaveBeenCalledWith(
      { work_id: "w1", source: "comix", external_id: "3ezr0" },
      { onConflict: "work_id,source" },
    )
  })

  it("no_match: resolveComixUrl devolve null → null, não persiste", async () => {
    mockResolve.mockResolvedValue(null)
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase })
    expect(r).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("fail-soft: resolveComixUrl lançando não propaga (devolve null)", async () => {
    mockResolve.mockRejectedValue(new Error("boom"))
    const { supabase, upsert } = fakeSupabase()
    const r = await ensureComixHid({ ...baseParams(), supabase })
    expect(r).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe("persistComixHid", () => {
  it("upsert de 1 linha (onConflict work_id,source) → true", async () => {
    const { supabase, upsert } = fakeSupabase()
    const ok = await persistComixHid(supabase, "w9", "hidX")
    expect(ok).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      { work_id: "w9", source: "comix", external_id: "hidX" },
      { onConflict: "work_id,source" },
    )
  })

  it("erro do supabase → false (fail-soft, não lança)", async () => {
    const upsert = vi.fn(async () => ({ error: { message: "db down" } }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = { from: vi.fn(() => ({ upsert })) } as any
    expect(await persistComixHid(supabase, "w1", "h")).toBe(false)
  })
})
