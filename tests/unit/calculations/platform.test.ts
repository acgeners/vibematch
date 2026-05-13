import { describe, it, expect } from "vitest"
import { calculatePlatformAvg, sumVotes } from "@/lib/calculations/platform"
import type { PlatformRating } from "@/types/domain"

const mockRating = (
  platform: "mangaupdates" | "animeplanet" | "comick",
  rating: number,
  votes: number
): PlatformRating => ({
  id: crypto.randomUUID(),
  work_id: "w1",
  platform,
  rating,
  vote_count: votes,
})

describe("calculatePlatformAvg", () => {
  it("retorna null sem ratings válidos", () => {
    expect(calculatePlatformAvg([], 8.0, 1767)).toBeNull()
  })

  it("retorna null se todos os votos são zero", () => {
    const ratings = [mockRating("mangaupdates", 8.0, 0)]
    expect(calculatePlatformAvg(ratings, 8.0, 1767)).toBeNull()
  })

  it("com zero votos reais, puxa para o globalMean", () => {
    // plataforma com votos=0 é ignorada, resultado é null
    const ratings = [mockRating("animeplanet", 9.5, 0)]
    expect(calculatePlatformAvg(ratings, 8.0, 1767)).toBeNull()
  })

  it("com muitos votos, resultado se aproxima da média das plataformas", () => {
    const ratings = [
      mockRating("mangaupdates", 8.0, 10000),
      mockRating("animeplanet", 8.4, 10000),
    ]
    const result = calculatePlatformAvg(ratings, 8.0, 1767)
    // totalVotes=20000, pseudo=1767 → quase tudo local
    expect(result).toBeCloseTo(8.2, 0)
  })

  it("com poucos votos, resultado fica mais próximo do globalMean", () => {
    const ratings = [mockRating("comick", 5.0, 10)]
    const result = calculatePlatformAvg(ratings, 8.0, 1767)!
    // poucos votos → puxa para globalMean=8.0
    expect(result).toBeGreaterThan(7.5)
  })
})

describe("sumVotes", () => {
  it("soma votos de todas as plataformas", () => {
    const ratings = [
      mockRating("mangaupdates", 8, 263),
      mockRating("animeplanet", 8.2, 2622),
      mockRating("comick", 9, 366),
    ]
    expect(sumVotes(ratings)).toBe(3251)
  })

  it("retorna 0 para lista vazia", () => {
    expect(sumVotes([])).toBe(0)
  })
})
