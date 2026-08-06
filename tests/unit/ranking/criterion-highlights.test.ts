import { describe, it, expect } from "vitest"
import { criterionHighlights } from "@/lib/ranking/criterion-highlights"
import type { HighlightWeight } from "@/lib/ranking/criterion-highlights"

// Momentos REAIS do catálogo (973 obras com os 9 atributos, medido em 2026-08-06).
const MOMENTS = {
  romance: { mean: 7.43, sd: 1.16 },
  couple_dynamics: { mean: 5.98, sd: 1.71 },
  protagonist: { mean: 7.21, sd: 0.89 },
  fantasy_nobility: { mean: 7.27, sd: 1.66 },
  action_adventure: { mean: 4.49, sd: 1.35 },
  humor: { mean: 4.7, sd: 1.97 },
  drama: { mean: 6.66, sd: 1.32 },
  tragedy: { mean: 3.82, sd: 1.73 },
  adult_content: { mean: 5.28, sd: 2.82 },
}

const w = (slug: string, weight: number, threshold: number | null = null): HighlightWeight => ({
  slug, weight, threshold, is_active: true,
})
// Perfil do dono: romance/casal positivos, drama e tragédia NEGATIVOS com threshold.
const WEIGHTS: HighlightWeight[] = [
  w("romance", 3), w("couple_dynamics", 2.5), w("protagonist", 1.5),
  w("fantasy_nobility", 1), w("action_adventure", 1), w("humor", 1),
  w("drama", -1, 7), w("tragedy", -1.5, 5), w("adult_content", 0.5),
]

// "A Dream Escape" — notas reais.
const DREAM = {
  romance: 7.5, couple_dynamics: 8, protagonist: 8, fantasy_nobility: 8.5,
  action_adventure: 4.5, humor: 6.5, drama: 8.5, tragedy: 6, adult_content: 2,
}

describe("criterionHighlights", () => {
  it("só devolve o que passa de 1σ, ordenado por |z| e cortado em 3", () => {
    const hl = criterionHighlights(DREAM, MOMENTS, WEIGHTS)
    expect(hl.map((h) => h.slug)).toEqual(["drama", "tragedy", "couple_dynamics"])
    expect(hl.map((h) => Number(h.z.toFixed(1)))).toEqual([1.4, 1.3, 1.2])
    // adult_content (−1,17σ) fica de fora só pelo corte de exibição, não por ser fraco.
    const semCorte = criterionHighlights(DREAM, MOMENTS, WEIGHTS, { max: 9 })
    expect(semCorte.map((h) => h.slug)).toContain("adult_content")
  })

  it("devolve vazio quando nada foge do normal (6,5% do acervo)", () => {
    const naMedia = Object.fromEntries(Object.entries(MOMENTS).map(([s, m]) => [s, m.mean]))
    expect(criterionHighlights(naMedia, MOMENTS, WEIGHTS)).toEqual([])
  })

  it("sem momentos não inventa nada", () => {
    expect(criterionHighlights(DREAM, null, WEIGHTS)).toEqual([])
  })

  describe("favor/contra pelos pesos", () => {
    const favorOf = (scores: Record<string, number>, slug: string) =>
      criterionHighlights(scores, MOMENTS, WEIGHTS, { max: 9 }).find((h) => h.slug === slug)?.favor

    it("peso positivo: acima do catálogo = a favor, abaixo = contra", () => {
      expect(favorOf({ romance: 10 }, "romance")).toBe("favor")
      expect(favorOf({ romance: 5 }, "romance")).toBe("contra")
    })

    it("peso negativo acima do threshold: conta CONTRA", () => {
      // drama 8,5 > threshold 7 → o excedente entra no numerador com peso negativo.
      expect(favorOf({ drama: 8.5 }, "drama")).toBe("contra")
    })

    it("peso negativo ABAIXO do threshold é NEUTRO, mesmo acima da média do catálogo", () => {
      // tragédia 6,0 está a +1,26σ do catálogo mas o threshold do usuário é... 5.
      expect(favorOf({ tragedy: 6 }, "tragedy")).toBe("contra")
      // …já com threshold 7, a mesma nota não penaliza nada: marcar ▼ seria mentira.
      const tolerante = WEIGHTS.map((x) => (x.slug === "tragedy" ? w("tragedy", -1.5, 7) : x))
      expect(
        criterionHighlights({ tragedy: 6 }, MOMENTS, tolerante, { max: 9 })[0].favor,
      ).toBe("neutro")
    })

    it("peso negativo BEM abaixo do catálogo conta a favor", () => {
      expect(favorOf({ tragedy: 0 }, "tragedy")).toBe("favor")
    })

    it("sem peso, peso zero ou peso inativo → neutro", () => {
      expect(criterionHighlights({ romance: 10 }, MOMENTS, [])[0].favor).toBe("neutro")
      expect(criterionHighlights({ romance: 10 }, MOMENTS, [w("romance", 0)])[0].favor).toBe("neutro")
      expect(
        criterionHighlights({ romance: 10 }, MOMENTS, [{ ...w("romance", 3), is_active: false }])[0].favor,
      ).toBe("neutro")
    })
  })
})
