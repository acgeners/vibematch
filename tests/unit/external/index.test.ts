import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchMultiSourceDetails } from "@/lib/external/index"
import type { MergedCandidate } from "@/lib/external/types"

describe("fetchMultiSourceDetails", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserva ID confiável do AnimePlanet mesmo quando o scraping é bloqueado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Just a moment...", {
      status: 403,
      headers: { "cf-mitigated": "challenge" },
    })))

    const candidate: MergedCandidate = {
      title: "I Was Possessed, but It Became a Ghost Story",
      sources: ["animeplanet"],
      trustedSources: ["animeplanet"],
      animePlanetSlug: "i-was-possessed-but-it-became-a-ghost-story",
    }

    const result = await fetchMultiSourceDetails(candidate)

    expect(result.data.externalIds).toEqual({
      animeplanet: "i-was-possessed-but-it-became-a-ghost-story",
    })
    expect(result.data.apRating).toBeUndefined()
    expect(result.data.apVotes).toBeUndefined()
  })
})
