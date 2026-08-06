import { describe, it, expect } from "vitest"
import {
  whyThisWork,
  forceMomentsOf,
  separatorCoverage,
  SEPARATOR_MIN_SIGMA,
  FORCE_KEYS,
} from "@/lib/ranking/why-this-work"
import type { WhyThisWorkInput, ForceMoments } from "@/lib/ranking/why-this-work"

/**
 * `platformAvg` é 0–10 e vira 0–100 (×10); `totalVotes` vira Alcance por
 * log(votos)/log(50k). Os helpers abaixo montam obras com forças previsíveis
 * para os testes falarem em 0–100, que é a unidade da função.
 */
const work = (o: Partial<WhyThisWorkInput> = {}): WhyThisWorkInput => ({
  chanceScore: 60,
  platformAvg: 8,
  totalVotes: 1000,
  ...o,
})

/** Votos que produzem aproximadamente o Alcance pedido (0–100). */
const votesForAlcance = (target: number) => Math.round(Math.expm1((target / 100) * Math.log1p(50000)))

const flatMoments: ForceMoments = {
  chance: { mean: 60, sd: 10 },
  avaliacao: { mean: 80, sd: 10 },
  alcance: { mean: 60, sd: 10 },
}

describe("forceMomentsOf", () => {
  it("calcula média e σ populacional (÷ n), igual ao getCriterionMoments", () => {
    // Chance 50 e 70 → média 60, σ populacional 10 (amostral seria 14,14)
    const m = forceMomentsOf([work({ chanceScore: 50 }), work({ chanceScore: 70 })])
    expect(m.chance?.mean).toBeCloseTo(60, 6)
    expect(m.chance?.sd).toBeCloseTo(10, 6)
  })

  it("ignora força sem dado em vez de contá-la como zero", () => {
    // chance null não pode virar 0 e puxar a média para baixo
    const m = forceMomentsOf([work({ chanceScore: null }), work({ chanceScore: 80 })])
    expect(m.chance?.mean).toBeCloseTo(80, 6)
    expect(m.chance?.sd).toBeCloseTo(0, 6)
  })

  it("omite a força quando nenhuma obra tem o dado", () => {
    const m = forceMomentsOf([work({ totalVotes: 0 }), work({ totalVotes: 0 })])
    expect(m.alcance).toBeUndefined()
  })
})

describe("whyThisWork — guardas", () => {
  it("devolve null para grupo de uma obra (não há de quem diferir)", () => {
    const w = work()
    expect(whyThisWork(w, [w], flatMoments)).toBeNull()
  })

  it("devolve null sem moments", () => {
    const g = [work({ chanceScore: 20 }), work({ chanceScore: 90 })]
    expect(whyThisWork(g[0], g, null)).toBeNull()
    expect(whyThisWork(g[0], g, undefined)).toBeNull()
  })

  it("devolve null quando ninguém passa do limiar — o miolo do tier é resposta, não falha", () => {
    const g = [work({ chanceScore: 60 }), work({ chanceScore: 61 }), work({ chanceScore: 59 })]
    for (const w of g) expect(whyThisWork(w, g, flatMoments)).toBeNull()
  })

  it("ignora força com σ = 0 em vez de estourar o z", () => {
    // σ = 0 dividiria por zero e produziria Infinity — afirmação máxima sobre ruído
    const g = [work({ chanceScore: 10 }), work({ chanceScore: 90 })]
    const zeroSd: ForceMoments = { chance: { mean: 50, sd: 0 } }
    expect(whyThisWork(g[1], g, zeroSd)).toBeNull()
  })

  it("ignora σ minúsculo mas NÃO-zero — o caso que o isFinite não pega", () => {
    // σ = 1e-9 não produz Infinity: produz z = 5e8, finito, e passaria o limiar.
    // Sem a guarda de MIN_USABLE_SD a função afirmaria com força máxima sobre um
    // acervo onde a dispersão real é nula.
    // (1 ponto de diferença, e não uma fração: computeWorkForces ARREDONDA as
    //  forças para inteiro, então diferenças sub-unitárias somem antes daqui.)
    const g = [work({ chanceScore: 60 }), work({ chanceScore: 61 })]
    const tinySd: ForceMoments = { chance: { mean: 60, sd: 1e-9 } }
    expect(whyThisWork(g[1], g, tinySd)).toBeNull()
  })

  it("as forças são INTEIRAS (computeWorkForces arredonda) — diferença fracionária não existe", () => {
    const m = forceMomentsOf([work({ chanceScore: 60.4 }), work({ chanceScore: 60.4 })])
    expect(m.chance?.mean).toBe(60)
  })

  it("ignora a obra sem aquela força, sem quebrar as demais", () => {
    const semNota = work({ chanceScore: null, platformAvg: 9.5 })
    const g = [semNota, work({ platformAvg: 7 }), work({ platformAvg: 7 })]
    const sep = whyThisWork(semNota, g, flatMoments)
    expect(sep?.force).toBe("avaliacao")
  })
})

describe("whyThisWork — escolha da força", () => {
  it("elege a força com maior |z|, não a de maior desvio bruto", () => {
    // Avaliação desvia 6 pontos (σ 3 → z 2); Chance desvia 10 pontos (σ 20 → z 0,5).
    // Em valor bruto a Chance ganharia; em σ, quem separa é a Avaliação.
    const moments: ForceMoments = {
      chance: { mean: 60, sd: 20 },
      avaliacao: { mean: 80, sd: 3 },
      alcance: { mean: 60, sd: 10 },
    }
    const alvo = work({ chanceScore: 70, platformAvg: 8.6 })
    const par = work({ chanceScore: 50, platformAvg: 8.0 })
    const sep = whyThisWork(alvo, [alvo, par], moments)
    expect(sep?.force).toBe("avaliacao")
  })

  it("compara contra a média DO GRUPO, não contra a média do acervo", () => {
    // A obra está NA média do acervo (60) mas muito acima da do grupo (~20).
    const g = [work({ chanceScore: 60 }), work({ chanceScore: 20 }), work({ chanceScore: 20 })]
    const sep = whyThisWork(g[0], g, flatMoments)
    expect(sep?.force).toBe("chance")
    // média do grupo = 33,33 → z = (60 − 33,33)/10 ≈ 2,67
    expect(sep!.z).toBeGreaterThan(2)
  })

  it("o sinal do z acompanha a direção do desvio", () => {
    const g = [work({ chanceScore: 20 }), work({ chanceScore: 80 }), work({ chanceScore: 80 })]
    expect(whyThisWork(g[0], g, flatMoments)!.z).toBeLessThan(0)
    expect(whyThisWork(g[1], g, flatMoments)!.z).toBeGreaterThan(0)
  })

  it("é determinística no empate de |z| (ordem de FORCE_KEYS)", () => {
    const moments: ForceMoments = {
      chance: { mean: 0, sd: 10 },
      avaliacao: { mean: 0, sd: 10 },
      alcance: { mean: 0, sd: 10 },
    }
    // chance e avaliacao desviam exatamente o mesmo do grupo
    const alvo = work({ chanceScore: 80, platformAvg: 10, totalVotes: 1000 })
    const par = work({ chanceScore: 60, platformAvg: 8, totalVotes: 1000 })
    const a = whyThisWork(alvo, [alvo, par], moments)
    const b = whyThisWork(alvo, [alvo, par], moments)
    expect(a).toEqual(b)
    expect(FORCE_KEYS.indexOf(a!.force)).toBeLessThanOrEqual(FORCE_KEYS.indexOf("alcance"))
  })
})

describe("whyThisWork — rank não afirma mais do que o dado sustenta", () => {
  it("marca max quando é o maior ÚNICO do grupo", () => {
    const g = [work({ chanceScore: 95 }), work({ chanceScore: 40 }), work({ chanceScore: 45 })]
    expect(whyThisWork(g[0], g, flatMoments)!.rank).toBe("max")
  })

  it("marca min quando é o menor ÚNICO do grupo", () => {
    const g = [work({ chanceScore: 10 }), work({ chanceScore: 70 }), work({ chanceScore: 75 })]
    expect(whyThisWork(g[0], g, flatMoments)!.rank).toBe("min")
  })

  it("EMPATE no topo vira 'above', nunca 'max' — 'a mais alta' seria falso nas duas", () => {
    const g = [
      work({ chanceScore: 95 }),
      work({ chanceScore: 95 }),
      work({ chanceScore: 40 }),
      work({ chanceScore: 40 }),
    ]
    expect(whyThisWork(g[0], g, flatMoments)!.rank).toBe("above")
    expect(whyThisWork(g[1], g, flatMoments)!.rank).toBe("above")
  })

  it("empate no fundo vira 'below', nunca 'min'", () => {
    const g = [
      work({ chanceScore: 20 }),
      work({ chanceScore: 20 }),
      work({ chanceScore: 80 }),
      work({ chanceScore: 80 }),
    ]
    expect(whyThisWork(g[0], g, flatMoments)!.rank).toBe("below")
  })

  it("value é a força da obra, e casa com o rank declarado", () => {
    const g = [work({ chanceScore: 90 }), work({ chanceScore: 30 }), work({ chanceScore: 35 })]
    const sep = whyThisWork(g[0], g, flatMoments)!
    expect(sep.value).toBe(90)
    expect(sep.rank).toBe("max")
  })
})

describe("whyThisWork — limiar", () => {
  it("SEPARATOR_MIN_SIGMA é 1σ, o mesmo dos chips de atributo", () => {
    expect(SEPARATOR_MIN_SIGMA).toBe(1)
  })

  it("corta logo abaixo do limiar e passa logo acima", () => {
    const moments: ForceMoments = { chance: { mean: 0, sd: 10 } }
    // grupo de 2: média = (v + 50)/2, então z = (v − 50)/20
    const abaixo = work({ chanceScore: 68, platformAvg: null, totalVotes: 0 }) // z = 0,9
    const acima = work({ chanceScore: 72, platformAvg: null, totalVotes: 0 }) // z = 1,1
    const base = work({ chanceScore: 50, platformAvg: null, totalVotes: 0 })
    expect(whyThisWork(abaixo, [abaixo, base], moments)).toBeNull()
    expect(whyThisWork(acima, [acima, base], moments)).not.toBeNull()
  })

  it("aceita limiar customizado", () => {
    const moments: ForceMoments = { chance: { mean: 0, sd: 10 } }
    const a = work({ chanceScore: 68, platformAvg: null, totalVotes: 0 })
    const b = work({ chanceScore: 50, platformAvg: null, totalVotes: 0 })
    expect(whyThisWork(a, [a, b], moments)).toBeNull()
    expect(whyThisWork(a, [a, b], moments, { threshold: 0.5 })).not.toBeNull()
  })
})

describe("separatorCoverage", () => {
  it("conta quantas obras do grupo têm separador", () => {
    const g = [
      work({ chanceScore: 95 }),
      work({ chanceScore: 5 }),
      work({ chanceScore: 50 }),
      work({ chanceScore: 50 }),
    ]
    const moments = forceMomentsOf(g)
    const c = separatorCoverage(g, moments)
    expect(c.total).toBe(4)
    expect(c.withSeparator).toBeGreaterThanOrEqual(2)
    expect(c.withSeparator).toBeLessThanOrEqual(4)
  })

  it("um grupo perfeitamente homogêneo não separa ninguém", () => {
    const g = [work(), work(), work(), work()]
    expect(separatorCoverage(g, forceMomentsOf(g)).withSeparator).toBe(0)
  })
})

describe("integração com computeWorkForces", () => {
  it("Alcance entra em escala LOG de votos, não linear", () => {
    // 1k vs 30k votos: linear seria 30×; em log a diferença é bem menor.
    const poucos = work({ totalVotes: 1000, chanceScore: null, platformAvg: null })
    const muitos = work({ totalVotes: 30000, chanceScore: null, platformAvg: null })
    const m = forceMomentsOf([poucos, muitos])
    expect(m.alcance!.mean).toBeGreaterThan(0)
    const sep = whyThisWork(muitos, [poucos, muitos], m)
    expect(sep?.force).toBe("alcance")
    expect(sep?.rank).toBe("max")
  })

  it("votos zerados = sem Alcance, e a força some do cálculo", () => {
    const g = [
      work({ totalVotes: 0, chanceScore: 90 }),
      work({ totalVotes: 0, chanceScore: 30 }),
      work({ totalVotes: 0, chanceScore: 30 }),
    ]
    const m = forceMomentsOf(g)
    expect(m.alcance).toBeUndefined()
    expect(whyThisWork(g[0], g, m)?.force).toBe("chance")
  })

  it("votesForAlcance produz o Alcance esperado (sanidade do helper do teste)", () => {
    const alvo = 50
    const m = forceMomentsOf([work({ totalVotes: votesForAlcance(alvo) })])
    expect(m.alcance!.mean).toBeCloseTo(alvo, 0)
  })
})
