// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Os tetos da orquestração das reviews para as fontes que só passam pelo FlareSolverr, e o
// ComicK parcial. Testa o FATO (o que chega ao pool e o que vira falha), com o relógio
// controlado — não as constantes: um teto menor que o tempo medido na Fly é exatamente o
// defeito que fazia o aumento no adapter não valer nada.
//
// Medido na Fly em 06/10/2026, CPU livre: AnimePlanet ~8,0 s; ComicK API 4,4 s + comentários
// 15,9 s. Os tetos antigos eram 12 s (AnimePlanet) e 18 s (ComicK, a coleta inteira).

vi.mock("@/lib/external/comick", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/comick")>()),
  collectComicKReviews: vi.fn(),
}))
vi.mock("@/lib/external/animeplanet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external/animeplanet")>()),
  fetchAnimePlanetReviews: vi.fn(),
}))

import { collectReviewsFromCandidate } from "@/lib/external/index"
import { collectComicKReviews } from "@/lib/external/comick"
import { fetchAnimePlanetReviews } from "@/lib/external/animeplanet"
import type { MergedCandidate } from "@/lib/external/types"

const comick = vi.mocked(collectComicKReviews)
const animeplanet = vi.mocked(fetchAnimePlanetReviews)
const TEXT = (n: number) => `Review ${n}: ${"um texto de leitor comprido o bastante pra passar no filtro de tamanho ".repeat(2)}`

const candidate = (ids: Partial<MergedCandidate>): MergedCandidate => ({
  title: "Solo Leveling",
  sources: ["comick", "animeplanet"],
  ...ids,
})

/** Resolve só depois de `ms` no relógio falso. */
const after = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function collect(c: MergedCandidate, advanceMs: number) {
  const pending = collectReviewsFromCandidate(c)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return pending
}

describe("ComicK parcial na orquestração", () => {
  it("API entregou e os comentários falharam: as reviews entram no pool e o ComicK NÃO vira failedSource", async () => {
    comick.mockResolvedValue({ reviews: [TEXT(1), TEXT(2)], partialFailure: "comentários: página não carregou no orçamento" })

    const out = await collect(candidate({ comickHid: "H" }), 0)

    expect(out.reviews.filter((r) => r.source === "comick")).toHaveLength(2)
    expect(out.failedSources).not.toContain("comick")
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toMatch(/comick=2\(.*parcial: comentários/)
  })

  it("as duas partes falharam: o ComicK É failedSource (vai pra 2ª passada)", async () => {
    comick.mockRejectedValue(new Error("ComicK: API e comentários falharam"))

    const out = await collect(candidate({ comickHid: "H" }), 0)

    expect(out.failedSources).toContain("comick")
    expect(out.reviews.filter((r) => r.source === "comick")).toHaveLength(0)
  })

  it("zero legítimo não é falha", async () => {
    comick.mockResolvedValue({ reviews: [] })

    const out = await collect(candidate({ comickHid: "H" }), 0)

    expect(out.failedSources).not.toContain("comick")
  })
})

describe("tetos da orquestração cobrem o tempo medido na Fly", () => {
  it("ComicK que leva 30 s (acima do teto antigo de 18 s) ainda entrega", async () => {
    comick.mockImplementation(() => after(30_000, { reviews: [TEXT(1)] }))

    const out = await collect(candidate({ comickHid: "H" }), 30_000)

    expect(out.failedSources).not.toContain("comick")
    expect(out.reviews.filter((r) => r.source === "comick")).toHaveLength(1)
  })

  it("AnimePlanet que leva 14 s (acima do teto antigo de 12 s) ainda entrega", async () => {
    animeplanet.mockImplementation(() => after(14_000, [TEXT(1), TEXT(2), TEXT(3)]))

    const out = await collect(candidate({ animePlanetSlug: "solo-leveling" }), 14_000)

    expect(out.failedSources).not.toContain("animeplanet")
    expect(out.reviews.filter((r) => r.source === "animeplanet")).toHaveLength(3)
  })

  it("o teto continua existindo: fonte travada de verdade ainda é cortada e vira falha", async () => {
    comick.mockImplementation(() => new Promise(() => {}))
    animeplanet.mockImplementation(() => new Promise(() => {}))

    const out = await collect(candidate({ comickHid: "H", animePlanetSlug: "solo-leveling" }), 120_000)

    expect(out.failedSources).toEqual(expect.arrayContaining(["comick", "animeplanet"]))
  })
})
