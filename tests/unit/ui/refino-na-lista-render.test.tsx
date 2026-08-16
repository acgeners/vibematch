import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

import { MoodListButton } from "@/components/ranking/mood-list-button"
import { DecisionCell } from "@/components/ranking/ranking-cells"

/**
 * Teste de RENDER de propósito, e não de função pura — o que regride aqui é a
 * árvore desenhada:
 *
 *  - a célula pode receber o valor ajustado e IMPRIMIR o base. A lista estaria
 *    ordenada por um número e mostrando outro, que é a invariante que custou
 *    19.624 pares de empate na Prioridade (2026-08-15) e que o teste de
 *    `displaySortValue` não enxerga, porque ele não desenha nada;
 *  - o gatilho pode existir sem nunca dizer que há refino ativo, e aí a única
 *    saída (limpar) fica inalcançável.
 */

afterEach(cleanup)

describe("célula de Prioridade com refino ativo", () => {
  it("imprime o valor AJUSTADO, não a base", () => {
    render(
      <DecisionCell score={8.4} affinity={null} expected={8.4} fitPercentile={70} alignment={null} moodAdjusted={9.1} />,
    )
    expect(screen.getByText("~9.1")).toBeTruthy()
    expect(screen.queryByText("~8.4")).toBeNull()
  })

  it("sem refino, segue imprimindo a base", () => {
    render(
      <DecisionCell score={8.4} affinity={null} expected={8.4} fitPercentile={70} alignment={null} />,
    )
    expect(screen.getByText("~8.4")).toBeTruthy()
  })

  it("ignora a AFINIDADE quando há refino — ela descreve a base", () => {
    // Sem isto, a célula mostraria "~84" (derivado da base) numa lista ordenada
    // pelo ajustado: o mesmo defeito, só que escondido atrás de outra escala.
    render(
      <DecisionCell score={8.4} affinity={84} expected={8.4} fitPercentile={70} alignment={null} moodAdjusted={9.1} />,
    )
    expect(screen.getByText("~9.1")).toBeTruthy()
    expect(screen.queryByText("~84")).toBeNull()
  })

  it("sem Prioridade base, o refino não inventa número", () => {
    render(
      <DecisionCell score={null} affinity={null} expected={null} fitPercentile={null} alignment={null} moodAdjusted={7} />,
    )
    expect(screen.getByText("—")).toBeTruthy()
  })
})

describe("gatilho do refino na barra da lista", () => {
  it("sem refino: oferece abrir", () => {
    const onOpen = vi.fn()
    render(
      <MoodListButton active={false} weights={0} exclusions={0} hiddenCount={0} onOpen={onOpen} onClear={() => {}} />,
    )
    fireEvent.click(screen.getByText("Refinar"))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("com refino: nomeia ajustes e exclusões SEPARADAMENTE, e dá a saída", () => {
    const onClear = vi.fn()
    render(
      <MoodListButton active weights={3} exclusions={1} hiddenCount={12} onOpen={() => {}} onClear={onClear} />,
    )
    // "3 ajustes · 12 obras fora" — juntar os dois num número só faria a pessoa
    // procurar no filtro da página as obras que o refino escondeu.
    expect(screen.getByText(/3 ajustes/)).toBeTruthy()
    expect(screen.getByText(/12 obras fora/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Limpar refino"))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it("sem exclusão, não fala de obras fora", () => {
    render(
      <MoodListButton active weights={2} exclusions={0} hiddenCount={0} onOpen={() => {}} onClear={() => {}} />,
    )
    expect(screen.getByText(/2 ajustes/)).toBeTruthy()
    expect(screen.queryByText(/fora/)).toBeNull()
  })
})
