import { describe, expect, it } from "vitest"
import {
  fmtSigma,
  readCriterionUnit,
  scoreToSigma,
  resolveMoodThresholds,
  sigmaToScore,
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
