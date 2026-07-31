import { describe, it, expect } from "vitest"
import { pickDeckWorks } from "@/lib/onboarding/deck-sampler"
import type { DeckCandidate } from "@/lib/onboarding/deck-sampler"

function c(id: string, genres: string[], popularity: number): DeckCandidate {
  return { id, genres, popularity }
}

describe("deck do onboarding — amostra por gênero", () => {
  it("round-robin: cobre TODOS os gêneros escolhidos antes de repetir", () => {
    const picked = pickDeckWorks(
      [
        c("r1", ["Romance"], 100),
        c("r2", ["Romance"], 90),
        c("f1", ["Fantasia"], 80),
        c("f2", ["Fantasia"], 70),
        c("d1", ["Drama"], 60),
      ],
      ["Romance", "Fantasia", "Drama"],
      3,
    )
    expect(picked).toEqual(["r1", "f1", "d1"])
  })

  it("dentro do gênero, mais popular primeiro", () => {
    const picked = pickDeckWorks([c("b", ["Romance"], 10), c("a", ["Romance"], 99)], ["Romance"], 2)
    expect(picked).toEqual(["a", "b"])
  })

  it("obra com dois gêneros amados entra UMA vez", () => {
    const picked = pickDeckWorks(
      [c("dupla", ["Romance", "Fantasia"], 100), c("f1", ["Fantasia"], 50), c("r2", ["Romance"], 40)],
      ["Romance", "Fantasia"],
      3,
    )
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
    expect(picked[0]).toBe("dupla")
  })

  it("gênero esgotado: completa por popularidade global", () => {
    const picked = pickDeckWorks(
      [c("h1", ["Horror"], 5), c("pop1", ["Comédia"], 100), c("pop2", ["Ação"], 90)],
      ["Horror"],
      3,
    )
    expect(picked).toEqual(["h1", "pop1", "pop2"])
  })

  it("sem gêneros (pulou a tela): fallback puro por popularidade", () => {
    const picked = pickDeckWorks(
      [c("meh", [], 1), c("hit", ["Romance"], 100), c("ok", [], 50)],
      [],
      2,
    )
    expect(picked).toEqual(["hit", "ok"])
  })

  it("determinístico: empate de popularidade desempata por id", () => {
    const a = pickDeckWorks([c("b", [], 10), c("a", [], 10)], [], 2)
    const b = pickDeckWorks([c("a", [], 10), c("b", [], 10)], [], 2)
    expect(a).toEqual(b)
    expect(a).toEqual(["a", "b"])
  })

  it("respeita o limite", () => {
    const many = Array.from({ length: 60 }, (_, i) => c(`w${String(i).padStart(2, "0")}`, ["Romance"], 60 - i))
    expect(pickDeckWorks(many, ["Romance"], 30)).toHaveLength(30)
  })
})
