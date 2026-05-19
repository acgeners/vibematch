import { afterEach, describe, expect, it, vi } from "vitest"
import { searchMangaUpdates } from "@/lib/external/mangaupdates"
import { bestTitleMatch } from "@/lib/external/index"

describe("searchMangaUpdates", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("usa hit_title como título alternativo para matches por alias", async () => {
    const query = "My Possession Became a Ghost Story"

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          hit_title: query,
          record: {
            series_id: 21802822004,
            title: "I Was Possessed, but It Became a Ghost Story",
            description: "The problem is that I woke up inside a coffin.",
            image: { url: { original: "https://cdn.mangaupdates.com/image/i518474.jpg" } },
            year: "2026",
            bayesian_rating: 7.52,
            rating_votes: 34,
            genres: [{ genre: "Fantasy" }],
          },
        },
      ],
    }), { status: 200 })))

    const [result] = await searchMangaUpdates(query)

    expect(result.title).toBe("I Was Possessed, but It Became a Ghost Story")
    expect(result.alternativeTitles).toContain(query)
    expect(bestTitleMatch(query, result)).toBe(1)
  })
})
