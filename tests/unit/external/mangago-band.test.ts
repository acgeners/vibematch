import { describe, expect, it } from "vitest"
import {
  DEFAULT_BAND_CONFIG,
  decideMangagoResolveBand,
  readBandConfigFromEnv,
} from "@/lib/external/mangago-band"
import type { MangagoBandConfig } from "@/lib/external/mangago-band"

const decide = (score: number, margin: number, risk = false, config?: MangagoBandConfig) =>
  decideMangagoResolveBand({ score, margin, isReverseSubstringRisk: risk, config }).band

describe("DEFAULT_BAND_CONFIG — âncora de regressão", () => {
  it("mantém exatamente os thresholds fixos anteriores", () => {
    expect(DEFAULT_BAND_CONFIG).toEqual({
      autoMinScore: 0.9,
      autoMinMargin: 0.08,
      acceptMinScore: 0.72,
      allowReverseSubstringAuto: false,
      allowDerivativeAuto: false,
    })
  })
})

describe("decideMangagoResolveBand — tabela", () => {
  it("1. 0.95 / 0.10 / sem risk → auto", () => {
    expect(decide(0.95, 0.1)).toBe("auto")
  })
  it("2. 0.95 / 0.03 / sem risk → review (margem baixa)", () => {
    expect(decide(0.95, 0.03)).toBe("review")
  })
  it("3. 0.89 / 0.20 / sem risk → review (score baixo)", () => {
    expect(decide(0.89, 0.2)).toBe("review")
  })
  it("4. 0.95 / 0.20 / com risk → review (reverse bloqueia auto)", () => {
    expect(decide(0.95, 0.2, true)).toBe("review")
  })
  it("5. 0.71 / margem alta / sem risk → reject", () => {
    expect(decide(0.71, 0.9)).toBe("reject")
  })
  it("6. limites exatos 0.90 / 0.08 → auto", () => {
    expect(decide(0.9, 0.08)).toBe("auto")
  })
  it("7. score exatamente 0.72 → review", () => {
    expect(decide(0.72, 0.9)).toBe("review")
  })

  it("8. config customizada muda os thresholds", () => {
    const cfg: MangagoBandConfig = {
      autoMinScore: 0.8,
      autoMinMargin: 0.05,
      acceptMinScore: 0.6,
      allowReverseSubstringAuto: false,
      allowDerivativeAuto: false,
    }
    expect(decide(0.85, 0.06, false, cfg)).toBe("auto") // seria review no default
    expect(decide(0.65, 0.5, false, cfg)).toBe("review") // ≥0.6 mas <0.8
    expect(decide(0.59, 0.9, false, cfg)).toBe("reject") // <0.6
  })

  it("9. allowReverseSubstringAuto=true permite auto com reverse risk", () => {
    const cfg: MangagoBandConfig = { ...DEFAULT_BAND_CONFIG, allowReverseSubstringAuto: true }
    expect(decide(0.95, 0.2, true, cfg)).toBe("auto")
  })

  it("reason explica a queda para review (observabilidade)", () => {
    expect(decideMangagoResolveBand({ score: 0.95, margin: 0.03, isReverseSubstringRisk: true }).reason).toBe(
      "margin_below_auto+reverse_substring_risk"
    )
    expect(decideMangagoResolveBand({ score: 0.5, margin: 0.9, isReverseSubstringRisk: false }).reason).toBe(
      "below_accept"
    )
    expect(decideMangagoResolveBand({ score: 0.95, margin: 0.2, isReverseSubstringRisk: false }).reason).toBe("auto")
  })

  // ---- E10B.6: derivative risk (doujinshi/derivado) nunca vira AUTO por padrão ----
  it("11. derivative risk com score alto/margem alta → review (nunca auto)", () => {
    // cenário Jujutsu title-only: 0.9/0.12 seria AUTO sem o guard.
    const d = decideMangagoResolveBand({ score: 0.9, margin: 0.12, isReverseSubstringRisk: false, isDerivativeRisk: true })
    expect(d.band).toBe("review")
    expect(d.reason).toBe("derivative_risk")
  })
  it("12. derivative risk com score abaixo do accept → reject", () => {
    expect(decideMangagoResolveBand({ score: 0.6, margin: 0.9, isReverseSubstringRisk: false, isDerivativeRisk: true }).band).toBe("reject")
  })
  it("13. derivative risk compõe com outros motivos no reason", () => {
    expect(
      decideMangagoResolveBand({ score: 0.85, margin: 0.02, isReverseSubstringRisk: false, isDerivativeRisk: true }).reason
    ).toBe("score_below_auto+margin_below_auto+derivative_risk")
  })
  it("14. allowDerivativeAuto=true permite auto com derivative risk", () => {
    const cfg: MangagoBandConfig = { ...DEFAULT_BAND_CONFIG, allowDerivativeAuto: true }
    expect(decideMangagoResolveBand({ score: 0.95, margin: 0.2, isReverseSubstringRisk: false, isDerivativeRisk: true, config: cfg }).band).toBe("auto")
  })
  it("15. sem derivative risk, comportamento inalterado (auto)", () => {
    expect(decideMangagoResolveBand({ score: 0.95, margin: 0.2, isReverseSubstringRisk: false, isDerivativeRisk: false }).band).toBe("auto")
  })
})

describe("readBandConfigFromEnv — parsing seguro", () => {
  it("sem env → defaults", () => {
    expect(readBandConfigFromEnv({})).toEqual(DEFAULT_BAND_CONFIG)
  })

  it("envs válidas → parseadas", () => {
    const cfg = readBandConfigFromEnv({
      MANGAGO_RESOLVE_AUTO_MIN_SCORE: "0.8",
      MANGAGO_RESOLVE_AUTO_MIN_MARGIN: "0",
      MANGAGO_RESOLVE_ACCEPT_MIN_SCORE: "0.6",
      MANGAGO_RESOLVE_ALLOW_REVERSE_SUBSTRING_AUTO: "true",
    })
    expect(cfg).toEqual({ autoMinScore: 0.8, autoMinMargin: 0, acceptMinScore: 0.6, allowReverseSubstringAuto: true, allowDerivativeAuto: false })
  })

  it("MANGAGO_RESOLVE_ALLOW_DERIVATIVE_AUTO liga o override (default false)", () => {
    expect(readBandConfigFromEnv({}).allowDerivativeAuto).toBe(false)
    expect(readBandConfigFromEnv({ MANGAGO_RESOLVE_ALLOW_DERIVATIVE_AUTO: "true" }).allowDerivativeAuto).toBe(true)
    expect(readBandConfigFromEnv({ MANGAGO_RESOLVE_ALLOW_DERIVATIVE_AUTO: "maybe" }).allowDerivativeAuto).toBe(false)
  })

  it("10. env inválida → defaults, sem NaN e sem comportamento inseguro", () => {
    const cfg = readBandConfigFromEnv({
      MANGAGO_RESOLVE_AUTO_MIN_SCORE: "abc",
      MANGAGO_RESOLVE_AUTO_MIN_MARGIN: "",
      MANGAGO_RESOLVE_ACCEPT_MIN_SCORE: "NaN",
      MANGAGO_RESOLVE_ALLOW_REVERSE_SUBSTRING_AUTO: "maybe",
    })
    expect(cfg).toEqual(DEFAULT_BAND_CONFIG)
    for (const v of [cfg.autoMinScore, cfg.autoMinMargin, cfg.acceptMinScore]) {
      expect(Number.isFinite(v)).toBe(true)
    }
    // Infinity também não passa
    expect(readBandConfigFromEnv({ MANGAGO_RESOLVE_AUTO_MIN_SCORE: "Infinity" }).autoMinScore).toBe(
      DEFAULT_BAND_CONFIG.autoMinScore
    )
  })
})
