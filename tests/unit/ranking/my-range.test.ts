import { describe, it, expect } from "vitest"
import {
  MY_RANGE_STEPS,
  myRangeBounds,
  myRangeParams,
  ownedSlugs,
  readMyRangeState,
} from "@/lib/ranking/my-range"
import type { IdealRange } from "@/lib/ranking/my-range"

/** Faixas reais do perfil (medidas no banco em 2026-08-08). */
const PROFILE: Record<string, IdealRange> = {
  romance: { ideal_min: 7, ideal_max: 9.5, weight: 0.9 },
  fantasy_nobility: { ideal_min: 7, ideal_max: 9.5, weight: 0.85 },
  couple_dynamics: { ideal_min: 6.5, ideal_max: 9, weight: 0.8 },
  protagonist: { ideal_min: 7, ideal_max: 9.5, weight: 0.75 },
  drama: { ideal_min: 5.5, ideal_max: 8.5, weight: 0.6 },
  humor: { ideal_min: 4, ideal_max: 8.5, weight: 0.5 },
  adult_content: { ideal_min: 2, ideal_max: 8.5, weight: 0.4 },
  tragedy: { ideal_min: 2, ideal_max: 6, weight: 0.35 },
  action_adventure: { ideal_min: 3, ideal_max: 6.5, weight: 0.3 },
}

const params = (o: Record<string, string>) => new URLSearchParams(o)

describe("myRangeBounds", () => {
  it("na tolerância zero devolve a faixa do perfil", () => {
    expect(myRangeBounds(PROFILE.romance, 0)).toEqual({ min: 7, max: 9.5 })
  })

  it("a folga alarga dos DOIS lados", () => {
    expect(myRangeBounds(PROFILE.drama, 1)).toEqual({ min: 4.5, max: 9.5 })
  })

  it("limiar que não recorta nada vira null, não '10'", () => {
    // romance 9,5 + 1 = 10,5 → o teto some. Escrever `max_romance=10` seria um
    // filtro que não filtra, ocupando vaga em "Filtros ativos" e no preset salvo.
    expect(myRangeBounds(PROFILE.romance, 1).max).toBeNull()
    // tragedy 2 − 2,5 = −0,5 → o piso some.
    expect(myRangeBounds(PROFILE.tragedy, 2.5).min).toBeNull()
  })

  it("arredonda DIRECIONAL pra grade de 0,5 — alarga, nunca aperta", () => {
    // Faixa fora da grade (o perfil vem de um LLM e pode devolver 7,3).
    const odd: IdealRange = { ideal_min: 7.3, ideal_max: 8.2, weight: 1 }
    const b = myRangeBounds(odd, 0)
    expect(b.min).toBe(7) // piso pra BAIXO
    expect(b.max).toBe(8.5) // teto pra CIMA
    // 🔴 Se apertasse (7,5 / 8,0), excluiria as obras com nota exatamente 7,0 e
    // 8,5 — que existem, porque as notas só assumem meios-pontos.
  })
})

describe("myRangeParams", () => {
  it("emite min_/max_ dos nove atributos", () => {
    const patch = myRangeParams(PROFILE, 0)
    expect(patch.min_romance).toBe("7")
    expect(patch.max_romance).toBe("9.5")
    expect(patch.min_couple_dynamics).toBe("6.5")
  })

  it("desligar limpa SÓ os atributos que o range governa", () => {
    const patch = myRangeParams(PROFILE, null)
    expect(Object.values(patch).every((v) => v === null)).toBe(true)
    // Um atributo fora do perfil nunca é tocado — o `min_x` posto à mão sobrevive.
    expect(patch).not.toHaveProperty("min_x")
  })

  it("não filtra por atributo sobre o qual o perfil não opina", () => {
    // Peso ~0 é o que a cor pinta de CINZA ("não tenho opinião"). Filtrar por ele
    // seria a cor dizendo uma coisa e a query fazendo outra.
    const mudo = { ...PROFILE, humor: { ideal_min: 4, ideal_max: 8.5, weight: 0 } }
    expect(ownedSlugs(mudo)).not.toContain("humor")
    expect(myRangeParams(mudo, 0)).not.toHaveProperty("min_humor")
  })
})

describe("readMyRangeState", () => {
  it("URL limpa = desligado", () => {
    expect(readMyRangeState(params({}), PROFILE)).toBeNull()
  })

  it("reconhece cada degrau a partir do que ele mesmo escreveu", () => {
    for (const { tolerance } of MY_RANGE_STEPS) {
      const patch = myRangeParams(PROFILE, tolerance)
      const url = new URLSearchParams()
      for (const [k, v] of Object.entries(patch)) if (v != null) url.set(k, v)
      expect(readMyRangeState(url, PROFILE)).toBe(tolerance)
    }
  })

  it("compara NÚMERO, não texto — '7.0' é o mesmo limiar que '7'", () => {
    const patch = myRangeParams(PROFILE, 0)
    const url = new URLSearchParams()
    for (const [k, v] of Object.entries(patch)) if (v != null) url.set(k, v)
    url.set("min_romance", "7.0")
    // 🔴 Comparar string deixaria apagado o botão que a pessoa acabou de clicar.
    expect(readMyRangeState(url, PROFILE)).toBe(0)
  })

  it("afrouxar UM atributo à mão vira 'custom', não um degrau", () => {
    const patch = myRangeParams(PROFILE, 0)
    const url = new URLSearchParams()
    for (const [k, v] of Object.entries(patch)) if (v != null) url.set(k, v)
    // O Casal sozinho corta 54% do catálogo — afrouxá-lo é o caso de uso real.
    url.set("min_couple_dynamics", "5")
    expect(readMyRangeState(url, PROFILE)).toBe("custom")
  })

  it("sem perfil não há estado a exprimir", () => {
    expect(readMyRangeState(params({ min_romance: "7" }), {})).toBeNull()
  })
})

describe("degraus oferecidos", () => {
  it("são DOIS, e o mais frouxo vem primeiro", () => {
    // ±2,5 foi cortado por medição: dos 40 do topo (top_n=40) ele derruba ZERO.
    // Um botão que acende e não muda a tela ensina que o filtro não funciona.
    expect(MY_RANGE_STEPS.map((s) => s.tolerance)).toEqual([1, 0])
  })
})
