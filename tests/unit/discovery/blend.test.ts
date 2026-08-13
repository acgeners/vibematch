import { describe, it, expect } from "vitest"
import {
  blendCandidates,
  midrankPercentiles,
  extremesDivergence,
  classifyCohesion,
  snapWeight,
  unionOfTops,
  diversify,
  countNearDuplicates,
  NEAR_DUPLICATE_WARN_AT,
  WEIGHT_STEPS,
  ANTI_WEIGHT,
  NEUTRAL_FIT_PCT,
  type BlendCandidate,
} from "@/lib/discovery/blend"

const cand = (
  workId: string,
  simPos: number,
  fitPercentile: number | null,
  simNeg = 0,
): BlendCandidate => ({ workId, simPos, simNeg, fitPercentile })

describe("midrankPercentiles", () => {
  it("distribui 0–100 nas pontas", () => {
    expect(midrankPercentiles([1, 2, 3])).toEqual([0, 50, 100])
  })

  it("dá o MESMO percentil a valores empatados", () => {
    // Sem midrank, a ordem de chegada viraria desempate invisível.
    const p = midrankPercentiles([5, 5, 9])
    expect(p[0]).toBe(p[1])
    expect(p[2]).toBe(100)
  })

  it("não quebra com 0 ou 1 elemento", () => {
    expect(midrankPercentiles([])).toEqual([])
    expect(midrankPercentiles([42])).toEqual([NEUTRAL_FIT_PCT])
  })
})

describe("blendCandidates — o peso do slider", () => {
  // A com parecença alta e alinhamento baixo; B o oposto. É o par que o slider existe
  // para separar — se ele não inverter aqui, não inverte em lugar nenhum.
  const parecida = cand("A", 0.40, 10)
  const minhaCara = cand("B", 0.20, 95)
  const par = [parecida, minhaCara]

  it("w=1 põe a parecida na frente", () => {
    expect(blendCandidates(par, 1)[0].workId).toBe("A")
  })

  it("w=0 põe a alinhada na frente", () => {
    expect(blendCandidates(par, 0)[0].workId).toBe("B")
  })

  it("clampa peso fora de [0,1] em vez de produzir score maluco", () => {
    expect(blendCandidates(par, 5)[0].workId).toBe("A")
    expect(blendCandidates(par, -3)[0].workId).toBe("B")
  })

  it("score fica sempre em 0–100", () => {
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      for (const r of blendCandidates(par, w)) {
        expect(r.score).toBeGreaterThanOrEqual(0)
        expect(r.score).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe("blendCandidates — anti-sementes", () => {
  it("penaliza quem se parece com a anti-semente", () => {
    const limpa = cand("limpa", 0.30, 50, 0.0)
    const suja = cand("suja", 0.30, 50, 0.4)
    const [primeiro] = blendCandidates([suja, limpa], 1)
    expect(primeiro.workId).toBe("limpa")
  })

  it("aplica ANTI_WEIGHT, não subtração cheia", () => {
    // Peso cheio (1.0) inverteria a ordem aqui; 0.5 preserva a preferência pela mais parecida.
    const forte = cand("forte", 0.40, 50, 0.30) // 0.40 − 0.5×0.30 = 0.25
    const fraca = cand("fraca", 0.24, 50, 0.00) // 0.24
    expect(blendCandidates([fraca, forte], 1)[0].workId).toBe("forte")
    expect(ANTI_WEIGHT).toBe(0.5)
  })

  it("simNeg=0 não altera a similaridade efetiva", () => {
    const r = blendCandidates([cand("x", 0.33, 50, 0)], 1)[0]
    expect(r.simEffective).toBeCloseTo(0.33, 10)
  })
})

describe("blendCandidates — sem perfil de gosto", () => {
  // Conta nova não tem percentil em obra nenhuma. O eixo deve ficar NEUTRO, não zerado.
  const semPerfil = [cand("a", 0.40, null), cand("b", 0.20, null), cand("c", 0.30, null)]

  it("ordena pela parecença quando ninguém tem alinhamento", () => {
    expect(blendCandidates(semPerfil, 0.5).map((r) => r.workId)).toEqual(["a", "c", "b"])
  })

  it("mantém a MESMA ordem em qualquer peso — o eixo ausente não desempata", () => {
    // Com fit=0 em vez de neutro, w=0 achataria tudo e a ordem viraria a do id.
    const meio = blendCandidates(semPerfil, 0.5).map((r) => r.workId)
    const soFit = blendCandidates(semPerfil, 0).map((r) => r.workId)
    expect(soFit).toEqual(meio)
  })

  it("obra sem percentil não é punida contra obra com percentil médio", () => {
    const [semFit, comFit] = blendCandidates(
      [cand("sem", 0.30, null), cand("com", 0.30, NEUTRAL_FIT_PCT)],
      0.5,
    )
    expect(semFit.score).toBeCloseTo(comFit.score, 10)
  })
})

describe("blendCandidates — ordenação estável", () => {
  it("desempata por id quando score e parecença empatam", () => {
    const iguais = [cand("zzz", 0.3, 50), cand("aaa", 0.3, 50), cand("mmm", 0.3, 50)]
    expect(blendCandidates(iguais, 0.5).map((r) => r.workId)).toEqual(["aaa", "mmm", "zzz"])
    // e a ordem de entrada não muda o resultado
    expect(blendCandidates([...iguais].reverse(), 0.5).map((r) => r.workId)).toEqual([
      "aaa",
      "mmm",
      "zzz",
    ])
  })

  it("lista vazia devolve vazio", () => {
    expect(blendCandidates([], 0.5)).toEqual([])
  })
})

describe("extremesDivergence", () => {
  it("conta quantas do topo trocam entre as pontas", () => {
    const c = [cand("p1", 0.9, 0), cand("p2", 0.8, 10), cand("f1", 0.1, 99), cand("f2", 0.2, 90)]
    // top-2 por parecença = p1,p2; por alinhamento = f1,f2 ⇒ trocam as 2
    expect(extremesDivergence(c, 2)).toBe(2)
  })

  it("é 0 quando os dois eixos concordam", () => {
    const c = [cand("a", 0.9, 99), cand("b", 0.8, 90), cand("c", 0.1, 5)]
    expect(extremesDivergence(c, 2)).toBe(0)
  })

  it("não estoura com topN maior que a lista", () => {
    expect(extremesDivergence([cand("a", 0.5, 50)], 10)).toBe(0)
  })
})

describe("snapWeight / WEIGHT_STEPS", () => {
  it("prende o peso na parada mais próxima", () => {
    expect(snapWeight(0.53)).toBe(0.5)
    expect(snapWeight(0.57)).toBe(0.6)
    expect(snapWeight(0)).toBe(0)
    expect(snapWeight(1)).toBe(1)
  })

  it("valor inválido cai no padrão, não em NaN", () => {
    expect(snapWeight(Number.NaN)).toBe(0.5)
    expect(snapWeight(99)).toBe(1)
    expect(snapWeight(-99)).toBe(0)
  })
})

describe("unionOfTops — a garantia que o slider depende", () => {
  // 60 obras com os dois eixos independentes, para que as pontas discordem de verdade.
  const muitos: BlendCandidate[] = Array.from({ length: 60 }, (_, i) =>
    cand(`w${String(i).padStart(2, "0")}`, (i % 17) / 40, ((i * 7) % 100)),
  )

  it("🔴 cobre o top-N de TODA parada do slider", () => {
    // É esta a invariante: se falhar, o usuário arrasta o slider e vê obra sem metadados.
    const pool = new Set(unionOfTops(muitos, 10, 0.5).map((b) => b.workId))
    for (const step of WEIGHT_STEPS) {
      for (const b of blendCandidates(muitos, step).slice(0, 10)) {
        expect(pool.has(b.workId), `peso ${step} mostraria ${b.workId}, fora do pool`).toBe(true)
      }
    }
  })

  it("começa pelo top do peso corrente — é o que a tela mostra antes de interagir", () => {
    const w = 0.8
    const esperado = blendCandidates(muitos, w).slice(0, 10).map((b) => b.workId)
    expect(unionOfTops(muitos, 10, w).slice(0, 10).map((b) => b.workId)).toEqual(esperado)
  })

  it("não repete obra", () => {
    const ids = unionOfTops(muitos, 10, 0.5).map((b) => b.workId)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it("é menor que o conjunto todo — senão não teria valor", () => {
    expect(unionOfTops(muitos, 10, 0.5).length).toBeLessThan(muitos.length)
  })

  it("lista vazia devolve vazio", () => {
    expect(unionOfTops([], 10, 0.5)).toEqual([])
  })
})

describe("classifyCohesion", () => {
  it("null vira unknown, não weak — 1 semente não é 'sem eixo comum'", () => {
    expect(classifyCohesion(null)).toBe("unknown")
  })

  it("classifica pelas faixas medidas", () => {
    expect(classifyCohesion(0.001)).toBe("weak") // sementes aleatórias
    expect(classifyCohesion(0.20)).toBe("fair")
    expect(classifyCohesion(0.37)).toBe("strong") // as 3 sementes reais medidas
  })
})

describe("diversify — MMR", () => {
  // 4 candidatos: A e B são quase idênticos (0,9) e lideram; C e D são distintos e vêm atrás.
  const ranked = [
    { workId: "A", simPos: 0, simNeg: 0, fitPercentile: 0, simEffective: 0, simPercentile: 0, score: 90 },
    { workId: "B", simPos: 0, simNeg: 0, fitPercentile: 0, simEffective: 0, simPercentile: 0, score: 88 },
    { workId: "C", simPos: 0, simNeg: 0, fitPercentile: 0, simEffective: 0, simPercentile: 0, score: 80 },
    { workId: "D", simPos: 0, simNeg: 0, fitPercentile: 0, simEffective: 0, simPercentile: 0, score: 78 },
  ]
  //        A     B     C     D
  const sim = [
    [0, 0.9, 0.05, 0.02],
    [0.9, 0, 0.04, 0.03],
    [0.05, 0.04, 0, 0.06],
    [0.02, 0.03, 0.06, 0],
  ]

  it("λ=1 é a identidade — a ordem por score, intacta", () => {
    expect(diversify(ranked, sim, 4, 1).map((r) => r.workId)).toEqual(["A", "B", "C", "D"])
  })

  it("🔴 com λ=0,8 a quase-duplicata cede a vez a quem é diferente", () => {
    // B (88) só perde para C (80) porque se parece 0,9 com A, que já entrou.
    const out = diversify(ranked, sim, 3, 0.8).map((r) => r.workId)
    expect(out[0]).toBe("A")
    expect(out, "B deveria ter cedido a vez").not.toContain("B")
    expect(out).toEqual(["A", "C", "D"])
  })

  it("não descarta ninguém — só reordena", () => {
    const out = diversify(ranked, sim, 4, 0.8)
    expect(out.map((r) => r.workId).sort()).toEqual(["A", "B", "C", "D"])
  })

  it("matriz ausente/incompleta não penaliza (erra para o lado de não esconder)", () => {
    expect(diversify(ranked, [], 4, 0.8).map((r) => r.workId)).toEqual(["A", "B", "C", "D"])
  })

  it("respeita k e não estoura com k maior que a lista", () => {
    expect(diversify(ranked, sim, 2, 0.8)).toHaveLength(2)
    expect(diversify(ranked, sim, 99, 0.8)).toHaveLength(4)
    expect(diversify([], sim, 5, 0.8)).toEqual([])
  })

  it("a penalidade é comparável ao score — senão λ fica ligado sem efeito", () => {
    // Sem multiplicar a similaridade por 100, a penalidade máxima (0,2×1) seria 0,2 ponto
    // num score de 0–100 e NADA mudaria de posição. Este caso falha nessa versão.
    const semEscala = diversify(ranked, sim, 3, 0.8).map((r) => r.workId)
    expect(semEscala).not.toEqual(["A", "B", "C"])
  })
})

describe("countNearDuplicates", () => {
  const sim = [
    [0, 0.9, 0.1],
    [0.9, 0, 0.1],
    [0.1, 0.1, 0],
  ]
  it("conta os pares acima do limiar", () => {
    expect(countNearDuplicates([{ index: 0 }, { index: 1 }, { index: 2 }], sim)).toBe(1)
  })
  it("zero quando ninguém se parece", () => {
    expect(countNearDuplicates([{ index: 0 }, { index: 2 }], sim)).toBe(0)
  })
})

describe("NEAR_DUPLICATE_WARN_AT", () => {
  it("🔴 fica acima do p90 medido — senão vira alarme que sempre toca", () => {
    // Distribuição medida pós-diversificação em 12 listas: mediana 2, p90 4.
    // Um limiar <= 4 acenderia em ~25% das listas; o aviso só informa se for raro.
    const distribuicaoMedida = [0, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 23]
    const acende = distribuicaoMedida.filter((n) => n > NEAR_DUPLICATE_WARN_AT).length
    expect(acende / distribuicaoMedida.length).toBeLessThanOrEqual(0.1)
    expect(NEAR_DUPLICATE_WARN_AT).toBeGreaterThan(4)
  })
})
