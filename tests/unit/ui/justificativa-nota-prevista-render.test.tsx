import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ExpectedExplanation, formatContribution } from "@/components/titles/expected-explanation"
import type { ExpectedExplanationPayload } from "@/lib/calculations/expected-explanation"

/**
 * "Por que esta nota?" na página da obra. Teste de RENDER: um teste do objeto passaria verde com a
 * justificativa de OUTRA nota na tela, com o total diferente do número do card ou com o bloco
 * aparecendo vazio.
 */

const payload: ExpectedExplanationPayload = {
  v: 1,
  base: 7.5,
  contributions: { romance: 0.4, "IA(n)": 0.1, AvoidedTagOverlap: -0.3, "Nota.M": -0.05 },
  obs: 0.2,
  score: 7.85,
}

describe("ExpectedExplanation", () => {
  it("mostra a partida, os grupos com sinal, o ajuste manual e o total = a nota do card", () => {
    render(<ExpectedExplanation payload={payload} shownScore={7.85} />)
    const bloco = screen.getByTestId("expected-explanation")
    expect(bloco.textContent).toContain("Por que esta nota?")
    expect(bloco.textContent).toContain("Partindo da obra média")
    expect(bloco.textContent).toContain("7,50")
    expect(bloco.textContent).toContain("Atributos da obra")
    expect(bloco.textContent).toContain("+0,50")
    expect(bloco.textContent).toContain("Seu gosto")
    expect(bloco.textContent).toContain("−0,30")
    expect(bloco.textContent).toContain("Romance")
    expect(bloco.textContent).toContain("Seu ajuste manual")
    expect(bloco.textContent).toContain("+0,20")
    expect(bloco.textContent).toContain("7,85")
  })

  it("não mostra justificativa de OUTRA nota (gravações diferentes)", () => {
    render(<ExpectedExplanation payload={payload} shownScore={8.4} />)
    expect(screen.queryByTestId("expected-explanation")).toBeNull()
  })

  it("sem nota ou sem justificativa, nada", () => {
    const { rerender } = render(<ExpectedExplanation payload={null} shownScore={7.85} />)
    expect(screen.queryByTestId("expected-explanation")).toBeNull()
    rerender(<ExpectedExplanation payload={payload} shownScore={null} />)
    expect(screen.queryByTestId("expected-explanation")).toBeNull()
  })

  it("sem nenhuma parcela (modelo sem treino), não finge explicar a média", () => {
    render(<ExpectedExplanation payload={{ v: 1, base: 7.4, contributions: {}, obs: 0, score: 7.4 }} shownScore={7.4} />)
    expect(screen.queryByTestId("expected-explanation")).toBeNull()
  })

  it("avisa quando a nota não é a soma porque a conta passou do limite", () => {
    render(
      <ExpectedExplanation
        payload={{ v: 1, base: 9.8, contributions: { romance: 0.6 }, obs: 0, score: 10 }}
        shownScore={10}
      />,
    )
    expect(screen.getByTestId("expected-explanation").textContent).toContain("limite da escala")
  })
})

describe("formatContribution", () => {
  it("sempre com sinal, menos tipográfico e vírgula", () => {
    expect(formatContribution(0.412)).toBe("+0,41")
    expect(formatContribution(-0.18)).toBe("−0,18")
    expect(formatContribution(0.001)).toBe("±0,00")
  })
})
