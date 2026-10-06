// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Todo caminho do AnimePlanet que passa pelo bypass usa o MESMO orçamento, e ele cobre o
// tempo medido na Fly. Até 06/10/2026 os seis caminhos usavam o padrão de 5 s do FlareSolverr,
// que cabia no Mac (2,9 s) e cortava TODA página na Fly (~8,0 s com a CPU livre).

vi.mock("@/lib/external/flaresolverr", () => ({
  fetchHtmlWithCfFallback: vi.fn(async () => null),
  isCfBypassUnavailable: vi.fn(() => false),
}))

import {
  ANIMEPLANET_CF_ABORT_MS,
  fetchAnimePlanetByTitle,
  fetchAnimePlanetRecommendations,
  fetchAnimePlanetReviews,
  searchAnimePlanet,
} from "@/lib/external/animeplanet"
import { fetchHtmlWithCfFallback } from "@/lib/external/flaresolverr"

const fetchHtml = vi.mocked(fetchHtmlWithCfFallback)

beforeEach(() => {
  fetchHtml.mockClear()
})

describe("AnimePlanet — orçamento do bypass", () => {
  it("cobre o tempo medido na Fly com folga", () => {
    expect(ANIMEPLANET_CF_ABORT_MS).toBeGreaterThanOrEqual(8_000 * 1.5)
  })

  it.each([
    ["detalhe (hidratação, canário)", () => fetchAnimePlanetByTitle("Solo Leveling", "solo-leveling")],
    ["detalhe sem slug (busca + fallback direto)", () => fetchAnimePlanetByTitle("Solo Leveling")],
    ["busca", () => searchAnimePlanet("Solo Leveling")],
    ["reviews", () => fetchAnimePlanetReviews("solo-leveling")],
    ["recomendações", () => fetchAnimePlanetRecommendations("solo-leveling")],
  ])("%s: toda chamada ao bypass leva o orçamento do AnimePlanet", async (_nome, run) => {
    await run()
    expect(fetchHtml).toHaveBeenCalled()
    for (const call of fetchHtml.mock.calls) expect(call[2]).toBe(ANIMEPLANET_CF_ABORT_MS)
  })
})
