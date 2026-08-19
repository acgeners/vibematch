import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ScorePill, ScoreThresholdEditor } from "@/components/ranking/score-pills"
import type { ScoreDef } from "@/components/ranking/score-pills"
import {
  equivalentGridThreshold,
  formatThresholdNumber,
  parseThresholdInput,
  thresholdToParam,
} from "@/lib/ranking/score-threshold"
import { SCORE_GRID } from "@/lib/ranking/criterion-unit"

/**
 * O campo manual dos limiares de nota (aba Notas do painel de filtros).
 *
 * Teste de RENDER de propósito: o que regride aqui é o CAMPO existir e o rótulo
 * do pill concordar com o valor gravado. Um teste que só exercitasse
 * `thresholdToParam` passaria verde com o campo fora da tela e com o pill
 * imprimindo "≥ 8" sobre um filtro de 7,5 — que era o estado anterior.
 */

// O Slider do Radix mede o trilho no mount; sem ResizeObserver o jsdom derruba
// a árvore inteira antes de o campo manual existir.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

afterEach(cleanup)

const sp = (q: string) => new URLSearchParams(q) as Pick<URLSearchParams, "get">

/** Nota Prevista: contínua (2,3% na grade de 0,5, medido em 2026-08-19). */
const EXPECTED: ScoreDef = {
  key: "expected",
  emoji: "🎯",
  label: "Nota Prevista",
  minKey: "min_expected",
  maxKey: "max_expected",
  min: 0,
  max: 10,
  step: 0.5,
  presets: [6, 7, 7.5, 8],
}

/** Atributo: escala 0–10 com passo 1 no controle, valores em múltiplos de 0,5. */
const CRITERION: ScoreDef = {
  key: "romance",
  emoji: "💕",
  label: "Romance",
  minKey: "min_romance",
  maxKey: "max_romance",
  min: 0,
  max: 10,
  step: 1,
  presets: [5, 6, 7, 8],
  grid: SCORE_GRID,
}

/** Alinhamento: a escala 0–100, onde o guard de ponta de escala errava. */
const FIT: ScoreDef = {
  key: "fit",
  emoji: "🧭",
  label: "Alinhamento",
  minKey: "min_fit",
  maxKey: "max_fit",
  min: 0,
  max: 100,
  step: 5,
  presets: [50, 75, 90],
}

/** Romance sob a lente σ (média 7,43, σ 1,16 — medido no catálogo). */
const CRITERION_SD: ScoreDef = {
  ...CRITERION,
  min: -6.4,
  max: 2.2,
  step: 0.25,
  presets: [0.5, 1, 1.5, 2],
  unit: "sd",
  moment: { mean: 7.43, sd: 1.16 },
  grid: undefined,
}

function editor(def: ScoreDef, query = "") {
  const updateParams = vi.fn()
  render(<ScoreThresholdEditor def={def} searchParams={sp(query)} updateParams={updateParams} />)
  return updateParams
}
const minField = () => screen.getByPlaceholderText("Mín")
const maxField = () => screen.getByPlaceholderText("Máx")

describe("campo manual de limiar de nota", () => {
  it("aceita valor fora do passo do controle e grava exatamente ele", () => {
    const updateParams = editor(EXPECTED)
    fireEvent.change(minField(), { target: { value: "7.3" } })
    expect(updateParams).toHaveBeenCalledWith({ min_expected: "7.3" })
  })

  it("aceita vírgula — a interface é em pt-BR", () => {
    const updateParams = editor(EXPECTED)
    fireEvent.change(minField(), { target: { value: "7,3" } })
    expect(updateParams).toHaveBeenCalledWith({ min_expected: "7.3" })
    // A régua pura, que é quem o campo chama: num `type="number"` o Chrome
    // devolveria "" pra isto e o filtro não aconteceria, calado.
    expect(parseThresholdInput("7,3")).toBe(7.3)
  })

  it("mantém o texto enquanto se digita — o rascunho não é reescrito pelo valor já gravado", () => {
    editor(EXPECTED)
    const campo = minField() as HTMLInputElement
    fireEvent.change(campo, { target: { value: "7," } })
    expect(campo.value).toBe("7,")
    fireEvent.change(campo, { target: { value: "7,3" } })
    expect(campo.value).toBe("7,3")
  })

  it("limpa o parâmetro quando o campo esvazia", () => {
    const updateParams = editor(EXPECTED, "min_expected=7.3")
    fireEvent.change(minField(), { target: { value: "" } })
    expect(updateParams).toHaveBeenCalledWith({ min_expected: null })
  })

  it("descarta limiar na ponta da escala — '≤ 10' não recorta ninguém", () => {
    const updateParams = editor(EXPECTED)
    fireEvent.change(maxField(), { target: { value: "10" } })
    expect(updateParams).toHaveBeenCalledWith({ max_expected: null })
  })

  it("grava o MÁXIMO nas notas de escala 0–100", () => {
    // Sonda do defeito antigo: o guard de ponta de escala era `p >= 10` fixo, e
    // com ele todo máximo de Alinhamento/Veredito (0–100) virava null — o
    // controle mostrava a faixa e a URL não recebia nada.
    const updateParams = editor(FIT)
    fireEvent.change(maxField(), { target: { value: "75" } })
    expect(updateParams).toHaveBeenCalledWith({ max_fit: "75" })
    expect(thresholdToParam(FIT, 75, "max")).toBe("75")
    expect(thresholdToParam(FIT, 100, "max")).toBeNull()
  })

  it("sob a lente σ o campo é em σ e a URL continua em PONTOS", () => {
    const updateParams = editor(CRITERION_SD)
    fireEvent.change(minField(), { target: { value: "1" } })
    // 7,43 + 1 × 1,16 = 8,59 → encaixado na grade de 0,5 (piso, pra não perder a borda).
    expect(updateParams).toHaveBeenCalledWith({ min_romance: "8.5" })
  })

  it("mostra o campo em σ com a unidade ao lado", () => {
    editor(CRITERION_SD)
    expect(screen.getByText("σ")).toBeTruthy()
  })
})

describe("o rótulo do pill diz o valor que a query aplica", () => {
  const label = (def: ScoreDef, query: string) => {
    cleanup()
    render(<ScorePill def={def} searchParams={sp(query)} selected={false} onSelect={() => {}} />)
    return screen.getByRole("button").textContent ?? ""
  }

  it("não arredonda pelas casas do PASSO do controle", () => {
    // Sonda do defeito antigo: `toFixed(scoreDecimals(1))` imprimia "≥ 8" com
    // 7,5 gravado — e 7,5 já era alcançável pela lente σ antes deste campo.
    expect(label(CRITERION, "min_romance=7.5")).toContain("≥ 7,5")
    expect(label(CRITERION, "min_romance=7.3")).toContain("≥ 7,3")
  })

  it("imprime em vírgula — a mesma convenção que o campo aceita", () => {
    // Dot no rótulo e vírgula no campo é duas convenções pro mesmo número a dois
    // centímetros um do outro, com o rascunho ainda em vírgula na mesma linha.
    expect(label(EXPECTED, "min_expected=7.42")).toContain("≥ 7,42")
    expect(parseThresholdInput("7,42")).toBe(7.42)
  })

  it("mantém as casas do passo quando o valor é redondo", () => {
    expect(label(EXPECTED, "min_expected=7")).toContain("≥ 7,0")
    expect(formatThresholdNumber(7, 0.5)).toBe("7,0")
  })
})

describe("dica de equivalência fora da grade", () => {
  it("aparece no atributo e aponta o vizinho de CIMA no mínimo", () => {
    editor(CRITERION, "min_romance=7.3")
    // 🔴 O vizinho é o TETO (7,5), não o piso: `≥ 7,3` exclui as obras de 7,0.
    // Apontar 7,0 (a direção do snapToScoreGrid, que existe pra ALARGAR limiar
    // convertido de σ) seria dizer o oposto do que a query faz.
    expect(screen.getByText(/recorta o mesmo que/).textContent).toContain("7,5")
    expect(equivalentGridThreshold(7.3, "min", SCORE_GRID)).toBe(7.5)
    expect(equivalentGridThreshold(7.3, "max", SCORE_GRID)).toBe(7)
  })

  it("fica calada nas notas contínuas — lá o valor intermediário recorta de verdade", () => {
    editor(EXPECTED, "min_expected=7.3")
    expect(screen.queryByText(/recorta o mesmo que/)).toBeNull()
  })

  it("fica calada quando o valor está na grade", () => {
    editor(CRITERION, "min_romance=7.5")
    expect(screen.queryByText(/recorta o mesmo que/)).toBeNull()
  })
})
