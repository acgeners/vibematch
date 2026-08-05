import { describe, expect, it } from "vitest"
import {
  fmtSigma,
  readCriterionUnit,
  scoreToSigma,
  resolveMoodThresholds,
  sigmaDomain,
  sigmaToScore,
  snapToScoreGrid,
} from "@/lib/ranking/criterion-unit"
import { MOOD_PRESETS } from "@/lib/constants/mood-presets"
import type { CriterionMoments } from "@/lib/ranking/criterion-unit"

/**
 * Momentos REAIS, medidos no catálogo em 2026-08-05 (973 obras com os 9
 * atributos). Usar os números de verdade é o ponto: o teste falha se a
 * conversão parar de refletir a assimetria que motiva a unidade existir.
 */
const MOMENTS: CriterionMoments = {
  romance: { mean: 7.43, sd: 1.16 },
  humor: { mean: 4.7, sd: 1.97 },
  adult_content: { mean: 5.29, sd: 2.81 },
  protagonist: { mean: 7.21, sd: 0.89 },
  drama: { mean: 6.66, sd: 1.32 },
  tragedy: { mean: 3.82, sd: 1.73 },
  couple_dynamics: { mean: 5.97, sd: 1.71 },
  fantasy_nobility: { mean: 7.27, sd: 1.66 },
  action_adventure: { mean: 4.49, sd: 1.35 },
}

const params = (init: Record<string, string>) => new URLSearchParams(init)

describe("unidade dos limiares de critério", () => {
  describe("readCriterionUnit", () => {
    it("default é pontos (sem o parâmetro)", () => {
      expect(readCriterionUnit(params({}))).toBe("points")
    })
    it("só 'sd' liga σ — valor desconhecido cai em pontos", () => {
      expect(readCriterionUnit(params({ crit_unit: "sd" }))).toBe("sd")
      expect(readCriterionUnit(params({ crit_unit: "zscore" }))).toBe("points")
    })
  })

  describe("sigmaToScore / scoreToSigma", () => {
    it("o MESMO limiar em pontos é uma coisa em romance e outra em humor", () => {
      // É a razão de ser da unidade: 7 é a média em romance e a cauda em humor.
      expect(scoreToSigma(7, MOMENTS.romance)).toBeCloseTo(-0.37, 2)
      expect(scoreToSigma(7, MOMENTS.humor)).toBeCloseTo(1.17, 2)
    })

    it("o mesmo σ vira notas diferentes em cada atributo", () => {
      expect(sigmaToScore(1, MOMENTS.romance)).toBeCloseTo(8.59, 2)
      expect(sigmaToScore(1, MOMENTS.humor)).toBeCloseTo(6.67, 2)
    })

    it("limita à escala 0–10 (σ alto não vira nota 12)", () => {
      expect(sigmaToScore(3, MOMENTS.romance)).toBe(10)
      expect(sigmaToScore(-3, MOMENTS.tragedy)).toBe(0)
    })

    it("σ = 0 devolve null nos dois sentidos — não divide por zero nem finge conversão", () => {
      const flat = { mean: 5, sd: 0 }
      expect(sigmaToScore(1, flat)).toBeNull()
      expect(scoreToSigma(5, flat)).toBeNull()
      expect(sigmaToScore(1, undefined)).toBeNull()
      expect(scoreToSigma(5, undefined)).toBeNull()
    })
  })

  describe("ida e volta entre as unidades (a lente de exibição)", () => {
    it("pontos → σ → pontos devolve o MESMO valor: a lente não altera o filtro", () => {
      // A URL guarda pontos e σ é só leitura, então trocar de unidade não pode
      // mexer em limiar nenhum. Antes de virar lente, a troca REESCREVIA a URL e
      // `romance ≥ 7` (506 obras) virava `≥ −0,25σ` = 7,14 pts → 452 obras.
      for (const [slug, m] of Object.entries(MOMENTS)) {
        for (const pontos of [0, 3.5, 5, 7, 8.5, 10]) {
          const z = scoreToSigma(pontos, m)!
          expect(sigmaToScore(z, m), `${slug} @ ${pontos}`).toBeCloseTo(pontos, 6)
        }
      }
    })

    it("sem momentos não há lente — a conversão devolve null e o controle fica em pontos", () => {
      expect(scoreToSigma(7, undefined)).toBeNull()
      expect(sigmaToScore(1, { mean: 5, sd: 0 })).toBeNull()
    })
  })

  describe("snapToScoreGrid — o limiar tem que existir na escala real", () => {
    it("🔴 +0,5σ em romance vira 8,0, não 8,01 — senão some com 421 obras", () => {
      // As notas saem em meios-pontos, e 8,0 é a nota de romance mais comum do
      // catálogo (421 obras). Um limiar em 8,01 não recorta nada a mais que 8,0:
      // só faz o pill mostrar "≥ 8" enquanto a query exclui todas elas.
      const bruto = sigmaToScore(0.5, MOMENTS.romance)!
      expect(bruto).toBeCloseTo(8.01, 2)
      expect(snapToScoreGrid(bruto, "min")).toBe(8)
    })

    it("mínimo desce e máximo sobe — a faixa nunca encolhe pelo encaixe", () => {
      expect(snapToScoreGrid(7.3, "min")).toBe(7)
      expect(snapToScoreGrid(7.3, "max")).toBe(7.5)
      expect(snapToScoreGrid(6.7, "min")).toBe(6.5)
      expect(snapToScoreGrid(6.7, "max")).toBe(7)
    })

    it("valor que já está na grade não se mexe", () => {
      for (const v of [0, 2.5, 6, 7.5, 10]) {
        expect(snapToScoreGrid(v, "min")).toBe(v)
        expect(snapToScoreGrid(v, "max")).toBe(v)
      }
    })

    it("não escapa da escala 0–10", () => {
      expect(snapToScoreGrid(10.4, "max")).toBe(10)
      expect(snapToScoreGrid(-0.3, "min")).toBe(0)
    })

    it("o limiar encaixado é sempre o que o pill em Pontos exibe", () => {
      // A invariante que faltava: exibição sem casas decimais só é honesta se o
      // valor gravado for redondo na grade das notas.
      for (const [slug, m] of Object.entries(MOMENTS)) {
        for (const z of [0.5, 1, 1.25, 2]) {
          const p = snapToScoreGrid(sigmaToScore(z, m)!, "min")
          expect(p * 2, `${slug} @ +${z}σ → ${p} não está na grade de 0,5`).toBe(Math.round(p * 2))
        }
      }
    })
  })

  describe("fmtSigma", () => {
    it("sempre mostra o sinal — '+1σ' e '1σ' não são a mesma leitura", () => {
      expect(fmtSigma(1)).toBe("+1σ")
      expect(fmtSigma(0)).toBe("+0σ")
      expect(fmtSigma(1.25)).toBe("+1.25σ")
    })
    it("negativo usa menos tipográfico (o hífen some no tabular-nums)", () => {
      expect(fmtSigma(-0.5)).toBe("−0.5σ")
    })
  })
})

describe("mood presets em σ", () => {
  const DENSO = {
    criterionMinSd: { drama: 1, protagonist: 0.5 },
    criterionMin: { drama: 8, protagonist: 7.7 },
  }

  it("σ manda quando há momentos", () => {
    const { min } = resolveMoodThresholds(DENSO, MOMENTS)
    expect(min.drama).toBeCloseTo(7.98, 2) // 6,66 + 1×1,32
    expect(min.protagonist).toBeCloseTo(7.66, 2) // 7,21 + 0,5×0,89
  })

  it("sem momentos, cai no fallback em pontos — nunca fica sem limiar", () => {
    const { min } = resolveMoodThresholds(DENSO, null)
    expect(min).toEqual({ drama: 8, protagonist: 7.7 })
  })

  it("🔴 o fallback é POR ATRIBUTO — um slug sem momento não afrouxa o preset inteiro", () => {
    // Só drama tem momento. Se protagonist sumisse, "Denso" devolveria mais
    // obras do que promete, sem erro nenhum.
    const { min } = resolveMoodThresholds(DENSO, { drama: MOMENTS.drama })
    expect(min.drama).toBeCloseTo(7.98, 2)
    expect(min.protagonist).toBe(7.7)
  })

  it("🔴 σ = 0 é limiar VÁLIDO (a média) — truthiness engoliria o Romance", () => {
    // `couple_dynamics: 0` é o preset Romance de verdade. Um `if (z)` no lugar
    // de `if (z != null)` descartaria o limiar e o botão afrouxaria em silêncio.
    const { min } = resolveMoodThresholds(
      { criterionMinSd: { romance: 0.5, couple_dynamics: 0 }, criterionMin: { romance: 8, couple_dynamics: 6 } },
      MOMENTS,
    )
    expect(min.couple_dynamics).toBeCloseTo(5.97, 2)
    expect(min.romance).toBeCloseTo(8.01, 2)
  })

  it("máximos seguem o mesmo caminho", () => {
    const { max } = resolveMoodThresholds(
      { criterionMaxSd: { drama: -0.5, tragedy: -0.5 }, criterionMax: { drama: 6, tragedy: 3 } },
      MOMENTS,
    )
    expect(max.drama).toBeCloseTo(6.0, 1)
    expect(max.tragedy).toBeCloseTo(2.96, 2)
  })
})

describe("os 5 mood presets de verdade", () => {
  it("todo preset com limiar em pontos tem o equivalente em σ", () => {
    // Guarda de regressão: um preset novo escrito só em pontos volta a apodrecer
    // conforme o catálogo cresce — foi assim que "Romance" virou 55% do acervo.
    for (const p of MOOD_PRESETS) {
      for (const [pontos, sd] of [
        ["criterionMin", "criterionMinSd"],
        ["criterionMax", "criterionMaxSd"],
      ] as const) {
        const emPontos = p[pontos]
        if (!emPontos) continue
        const emSd = p[sd]
        expect(emSd, `preset "${p.id}" tem ${pontos} sem ${sd}`).toBeDefined()
        expect(
          Object.keys(emSd ?? {}).sort(),
          `preset "${p.id}": ${pontos} e ${sd} cobrem atributos diferentes`,
        ).toEqual(Object.keys(emPontos).sort())
      }
    }
  })
})

describe("sigmaDomain — o domínio tem que cobrir a escala inteira", () => {
  it("🔴 todo ponto de 0 a 10 cai DENTRO do domínio, nos 9 atributos", () => {
    // A regressão que motivou isto: com faixa fixa [−2,5σ, +3σ], `min_romance=3`
    // ficava fora (−3,81σ), o Radix clampava, `lo > def.min` dava falso e o
    // commit gravava null — o filtro do usuário SUMIA ao mexer no outro thumb.
    for (const [slug, m] of Object.entries(MOMENTS)) {
      const { min, max } = sigmaDomain(m)
      for (let pontos = 0; pontos <= 10; pontos += 0.5) {
        const z = scoreToSigma(pontos, m)!
        expect(z, `${slug} @ ${pontos} pts abaixo do domínio`).toBeGreaterThanOrEqual(min)
        expect(z, `${slug} @ ${pontos} pts acima do domínio`).toBeLessThanOrEqual(max)
      }
    }
  })

  it("as pontas do domínio SÃO 0 e 10 em pontos — nem mais largo, nem mais estreito", () => {
    for (const [slug, m] of Object.entries(MOMENTS)) {
      const { min, max } = sigmaDomain(m)
      expect(sigmaToScore(min, m), `${slug}: ponta inferior`).toBeCloseTo(0, 6)
      expect(sigmaToScore(max, m), `${slug}: ponta superior`).toBeCloseTo(10, 6)
    }
  })

  it("a faixa fixa antiga NÃO cobria — o teste falharia em 7 dos 9", () => {
    // Documenta o tamanho do buraco que existia, pra ninguém reintroduzir uma
    // constante "larga o bastante" achando que resolve.
    const forasDaFaixaFixa = Object.entries(MOMENTS).filter(([, m]) => {
      const { min, max } = sigmaDomain(m)
      return min < -2.5 || max > 3
    })
    expect(forasDaFaixaFixa.length).toBe(7)
  })

  it("σ = 0 não passa por aqui (o builder já mantém o atributo em pontos)", () => {
    const { min, max } = sigmaDomain({ mean: 5, sd: 0 })
    expect(min).toBe(0)
    expect(max).toBe(0)
  })
})
