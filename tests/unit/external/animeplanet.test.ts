import { afterEach, describe, expect, it, vi } from "vitest"
import { parseAnimePlanetDetailHtml, searchAnimePlanet } from "@/lib/external/animeplanet"

describe("parseAnimePlanetDetailHtml", () => {
  it("extrai rating antigo do avgRating", () => {
    const detail = parseAnimePlanetDetailHtml(`
      <html>
        <head>
          <meta property="og:image" content="/images/manga/covers/example.jpg">
          <meta property="og:description" content="A useful synopsis.">
        </head>
        <body>
          <div class="avgRating" title="3.872 out of 5 from 819 votes"></div>
        </body>
      </html>
    `)

    expect(detail).toEqual({
      rating: 7.7,
      votes: 819,
      coverUrl: "https://www.anime-planet.com/images/manga/covers/example.jpg",
      synopsis: "A useful synopsis.",
    })
  })

  it("extrai rating de JSON-LD quando a classe visual muda", () => {
    const detail = parseAnimePlanetDetailHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Book",
              "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.21",
                "ratingCount": "1,234"
              }
            }
          </script>
        </head>
      </html>
    `)

    expect(detail).toEqual({
      rating: 8.4,
      votes: 1234,
      coverUrl: undefined,
      synopsis: undefined,
    })
  })
})

describe("searchAnimePlanet", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("não aceita fallback de slug direto quando a página não é detalhe real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><head><title>Not Found</title></head></html>", {
      status: 200,
    })))

    await expect(searchAnimePlanet("My Possession Became a Ghost Story")).resolves.toEqual([])
  })
})
