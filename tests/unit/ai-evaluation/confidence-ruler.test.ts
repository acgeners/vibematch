import { describe, expect, it } from "vitest"
import {
  describeCrossRuler,
  formatRuler,
  isSameRuler,
  OBSERVED_CONFIDENCE_MAX,
  rulerKey,
} from "@/lib/ai-evaluation/confidence-ruler"

const SONNET_5_V21 = { modelName: "claude-sonnet-5", promptVersion: "v21" }
const SONNET_46_V19 = { modelName: "claude-sonnet-4-6", promptVersion: "v19" }

describe("formatRuler", () => {
  it("corta o prefixo claude- e o sufixo de data do id", () => {
    expect(formatRuler(SONNET_5_V21)).toBe("sonnet-5/v21")
    expect(formatRuler({ modelName: "claude-haiku-4-5-20251001", promptVersion: "v8" })).toBe(
      "haiku-4-5/v8",
    )
  })

  it("degrada sem versão de prompt e devolve null sem nada", () => {
    expect(formatRuler({ modelName: "claude-opus-4-7", promptVersion: null })).toBe("opus-4-7")
    expect(formatRuler({ modelName: null, promptVersion: null })).toBeNull()
    expect(formatRuler(null)).toBeNull()
  })
})

describe("isSameRuler", () => {
  it("exige modelo E versão iguais", () => {
    expect(isSameRuler(SONNET_5_V21, { ...SONNET_5_V21 })).toBe(true)
    expect(isSameRuler(SONNET_5_V21, { modelName: "claude-sonnet-5", promptVersion: "v20" })).toBe(
      false,
    )
    expect(isSameRuler(SONNET_5_V21, SONNET_46_V19)).toBe(false)
  })

  it("trata dado faltando como régua DIFERENTE", () => {
    // Na dúvida a tela avisa: o custo de avisar à toa é uma linha de texto; o de
    // não avisar é a conclusão errada que este módulo existe pra evitar.
    expect(isSameRuler({ modelName: null, promptVersion: "v21" }, SONNET_5_V21)).toBe(false)
    expect(isSameRuler(SONNET_5_V21, null)).toBe(false)
    expect(isSameRuler(null, null)).toBe(false)
  })
})

describe("rulerKey", () => {
  it("é null só quando não há nenhuma procedência", () => {
    expect(rulerKey(SONNET_5_V21)).toBe("claude-sonnet-5/v21")
    expect(rulerKey({ modelName: null, promptVersion: null })).toBeNull()
  })
})

describe("describeCrossRuler", () => {
  it("não avisa quando a régua é a MESMA — a comparação é legítima", () => {
    expect(describeCrossRuler({ ...SONNET_5_V21, confidence: 0.75 }, SONNET_5_V21)).toBeNull()
  })

  it("não avisa quando não há avaliação IA atual", () => {
    expect(describeCrossRuler(null, SONNET_5_V21)).toBeNull()
  })

  it("avisa quando a config difere, nomeando as duas réguas", () => {
    const w = describeCrossRuler({ ...SONNET_46_V19, confidence: 0.82 }, SONNET_5_V21)
    expect(w).not.toBeNull()
    expect(w!.currentLabel).toBe("sonnet-4-6/v19")
    expect(w!.suggestedLabel).toBe("sonnet-5/v21")
    // O teto é medido por FAMÍLIA de modelo (n=371 = v20 + v21), então a frase que
    // o cita precisa de um rótulo sem a versão do prompt.
    expect(w!.suggestedModelLabel).toBe("sonnet-5")
    expect(w!.suggestedCeiling).toEqual(OBSERVED_CONFIDENCE_MAX["claude-sonnet-5"])
  })

  it("marca currentAboveCeiling quando a confiança atual é inalcançável hoje", () => {
    // O caso das 50 obras: 0,93 do sonnet-4-6 contra um teto observado de 0,88.
    const w = describeCrossRuler({ ...SONNET_46_V19, confidence: 0.93 }, SONNET_5_V21)
    expect(w!.currentAboveCeiling).toBe(true)
  })

  it("não marca currentAboveCeiling quando a confiança atual cabe no teto novo", () => {
    const w = describeCrossRuler({ ...SONNET_46_V19, confidence: 0.82 }, SONNET_5_V21)
    expect(w!.currentAboveCeiling).toBe(false)
  })

  it("não afirma teto de modelo com amostra pequena", () => {
    // Opus 4.7 tem n=4 — dizer "nunca passa de 60%" seria inventar uma
    // característica do modelo a partir de meia dúzia de sorteios.
    const w = describeCrossRuler(
      { ...SONNET_46_V19, confidence: 0.93 },
      { modelName: "claude-opus-4-7", promptVersion: "v21" },
    )
    expect(w!.suggestedCeiling).toBeNull()
    expect(w!.currentAboveCeiling).toBe(false)
  })

  it("não afirma teto de modelo desconhecido", () => {
    const w = describeCrossRuler(
      { ...SONNET_46_V19, confidence: 0.9 },
      { modelName: "claude-modelo-do-futuro", promptVersion: "v99" },
    )
    expect(w!.suggestedCeiling).toBeNull()
    expect(w!.currentAboveCeiling).toBe(false)
  })

  it("cala quando nenhum dos dois lados tem procedência", () => {
    expect(
      describeCrossRuler({ modelName: null, promptVersion: null, confidence: 0.8 }, null),
    ).toBeNull()
  })
})
