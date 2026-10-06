// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Tetos da HIDRATAÇÃO para as fontes que só passam pelo FlareSolverr. Antes, todas tinham 8 s.
// Com a fila única de páginas (uma por vez), numa hidratação elas esperam umas pelas outras:
// medido na Fly em 06/10/2026, ComicK 4,4 s + Comix 5,4 s na frente de um AnimePlanet de ~8 s.
// O teto agora deriva do orçamento do adapter; este arquivo prova o FATO — a fonte que
// respondeu dentro do orçamento chega ao resultado — e que o teto ainda corta a travada.

vi.mock("@/lib/external/animeplanet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/animeplanet")>()),
  fetchAnimePlanetByTitle: vi.fn(),
}))
vi.mock("@/lib/external/comix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comix")>()),
  fetchComixById: vi.fn(),
}))
vi.mock("@/lib/external/comick", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comick")>()),
  fetchComicKByHid: vi.fn(),
}))

import { fetchMultiSourceDetails } from "@/lib/external/index"
import { fetchAnimePlanetByTitle } from "@/lib/external/animeplanet"
import { fetchComixById } from "@/lib/external/comix"
import { fetchComicKByHid } from "@/lib/external/comick"
import type { MergedCandidate } from "@/lib/external/types"

const ap = vi.mocked(fetchAnimePlanetByTitle)
const comix = vi.mocked(fetchComixById)
const comick = vi.mocked(fetchComicKByHid)
const after = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
const never = () => new Promise<never>(() => {})

const candidate: MergedCandidate = {
  title: "Solo Leveling",
  sources: ["animeplanet", "comix", "comick"],
  trustedSources: ["animeplanet", "comix", "comick"],
  animePlanetSlug: "solo-leveling",
  comixHid: "003kd",
  comickHid: "71gMd0vF",
}

/** Fontes que a hidratação viu (aceitas OU rejeitadas). Cortada pelo teto = ausente das duas. */
const seen = (debug: { acceptedSources: { source: string }[]; rejectedSources: { source: string }[] } | undefined) =>
  new Set([...(debug?.acceptedSources ?? []), ...(debug?.rejectedSources ?? [])].map((s) => s.source))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  // Nada sai para a rede: qualquer outra chamada toma o desafio do Cloudflare na hora.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Just a moment...", { status: 403 })))
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function hydrate(advanceMs: number) {
  const pending = fetchMultiSourceDetails(candidate)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return pending
}

describe("hidratação — tetos das fontes do FlareSolverr", () => {
  it("cada fonte que responde dentro do próprio orçamento chega ao resultado, mesmo passando dos 8 s antigos", async () => {
    comick.mockImplementation(() => after(10_000, { title: "Solo Leveling", alternativeTitles: [], publicationStatus: "Completed", tags: [] }))
    comix.mockImplementation(() => after(9_000, { hid: "003kd", title: "Solo Leveling", alternativeTitles: [], tags: [] }))
    ap.mockImplementation(() => after(14_000, { rating: 9.2, votes: 34_608 }))

    const out = await hydrate(14_000)

    expect([...seen(out.debug)]).toEqual(expect.arrayContaining(["comick", "comix"]))
    expect(out.data.apRating).toBe(9.2)
  })

  it("o teto continua cortando a fonte travada de verdade", async () => {
    comick.mockImplementation(never)
    comix.mockImplementation(never)
    ap.mockImplementation(never)

    const out = await hydrate(120_000)

    expect([...seen(out.debug)]).not.toContain("comick")
    expect([...seen(out.debug)]).not.toContain("comix")
    expect(out.data.apRating).toBeUndefined()
  })
})
