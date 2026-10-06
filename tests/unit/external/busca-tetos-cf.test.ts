// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Teto da BUSCA ("Buscar dados") para AnimePlanet e ComicK. Era 8 s para todas as fontes, e na
// Fly uma página do AnimePlanet leva ~8,0 s (06/10/2026) — a busca dele nunca voltava. O teto
// agora deriva do orçamento do adapter; as demais fontes seguem em 8 s.

vi.mock("@/lib/external/animeplanet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/animeplanet")>()),
  searchAnimePlanet: vi.fn(),
}))
vi.mock("@/lib/external/comick", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comick")>()),
  searchComicK: vi.fn(),
}))

import { searchAllSourcesWithStatus } from "@/lib/external/index"
import { searchAnimePlanet } from "@/lib/external/animeplanet"
import { searchComicK } from "@/lib/external/comick"

const ap = vi.mocked(searchAnimePlanet)
const comick = vi.mocked(searchComicK)
const after = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 404 })))
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function search(advanceMs: number) {
  const pending = searchAllSourcesWithStatus("Solo Leveling")
  await vi.advanceTimersByTimeAsync(advanceMs)
  return pending
}

describe("busca — tetos das fontes do FlareSolverr", () => {
  it("AnimePlanet em 14 s e ComicK em 10 s ainda respondem (o teto antigo de 8 s os dava como falha)", async () => {
    ap.mockImplementation(() => after(14_000, []))
    comick.mockImplementation(() => after(10_000, []))

    const out = await search(14_000)

    expect(out.failedSources).not.toContain("animeplanet")
    expect(out.failedSources).not.toContain("comick")
  })

  it("travadas de verdade continuam virando falha", async () => {
    ap.mockImplementation(() => new Promise(() => {}))
    comick.mockImplementation(() => new Promise(() => {}))

    const out = await search(60_000)

    expect(out.failedSources).toEqual(expect.arrayContaining(["animeplanet", "comick"]))
  })
})
