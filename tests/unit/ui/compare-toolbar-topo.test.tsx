import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))

import { CompareToolbar } from "@/components/titles/compare-toolbar"
import type { CompareToolbarProps } from "@/components/titles/compare-toolbar"

/**
 * O topo do drawer de comparação, em RENDER.
 *
 * A régua que este teste guarda não é lógica: é O QUE FICA VISÍVEL. Até 2026-08-08 eram oito
 * controles em fila única; hoje "Só diferenças", "Melhor/pior" e "Salvar" vivem no `⋯`, e o
 * resumo "Onde diferenciam" é disclosure. Uma regressão aqui devolve controle à primeira fila
 * sem quebrar nada — e um menu que abre vazio é indistinguível de um menu que funciona até
 * alguém clicar.
 */
const noop = () => {}

function renderToolbar(props: Partial<CompareToolbarProps> = {}) {
  return render(
    <CompareToolbar
      title={<span>Comparar 5 obras</span>}
      differentialsCount={3}
      differentialsOpen={false}
      onToggleDifferentials={noop}
      view="table"
      onViewChange={noop}
      canSwitchView
      showBussola={false}
      rowsPicker={<button type="button">Linhas</button>}
      diffOnly={false}
      onDiffOnlyChange={noop}
      bestWorst
      onBestWorstChange={noop}
      persistRun
      onPersistRunChange={noop}
      isPaid
      reranking={false}
      canRerank
      onRerank={noop}
      onClear={noop}
      onClose={noop}
      {...props}
    />
  )
}

/** Radix abre no `pointerdown`, não no `click`. */
function openMenu() {
  const trigger = screen.getByLabelText("Mais opções de exibição")
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 })
  fireEvent.click(trigger)
}

afterEach(cleanup)

describe("topo da comparação: quem fica na primeira fila", () => {
  it("mostra só os quatro controles de primeira fila", () => {
    renderToolbar()
    for (const label of ["Tabela", "Bússola", "Linhas", "Desempatar com IA", "Limpar"]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByLabelText("Fechar")).toBeTruthy()
    // …e as preferências de leitura NÃO estão soltas no topo.
    expect(screen.queryByText("Só diferenças")).toBeNull()
    expect(screen.queryByText("Melhor/pior")).toBeNull()
    expect(screen.queryByText("Salvar o desempate")).toBeNull()
  })

  it("guarda as três no menu, com o estado de cada uma", () => {
    renderToolbar()
    openMenu()
    const diff = screen.getByRole("menuitemcheckbox", { name: /Só diferenças/ })
    const best = screen.getByRole("menuitemcheckbox", { name: /Melhor\/pior/ })
    const save = screen.getByRole("menuitemcheckbox", { name: /Salvar o desempate/ })
    expect(diff.getAttribute("aria-checked")).toBe("false")
    expect(best.getAttribute("aria-checked")).toBe("true")
    // Padrão do drawer desde 2026-08-08: o desempate já nasce salvo.
    expect(save.getAttribute("aria-checked")).toBe("true")
  })

  it("cada opção do menu explica o que faz", () => {
    renderToolbar()
    openMenu()
    expect(screen.getByText(/Esconde as linhas em que as obras empatam/)).toBeTruthy()
    expect(screen.getByText(/Pinta o maior e o menor valor de cada linha/)).toBeTruthy()
    expect(screen.getByText(/recomendação navegável/)).toBeTruthy()
  })
})

describe("topo da comparação: o menu só oferece o que se aplica", () => {
  it("na Bússola, sem linhas nem melhor/pior — sobra o salvar", () => {
    renderToolbar({ view: "bussola", showBussola: true })
    expect(screen.queryByText("Linhas")).toBeNull()
    openMenu()
    expect(screen.queryByRole("menuitemcheckbox", { name: /Só diferenças/ })).toBeNull()
    expect(screen.queryByRole("menuitemcheckbox", { name: /Melhor\/pior/ })).toBeNull()
    expect(screen.getByRole("menuitemcheckbox", { name: /Salvar o desempate/ })).toBeTruthy()
  })

  it("no plano free, o salvar sai do menu", () => {
    renderToolbar({ isPaid: false })
    openMenu()
    expect(screen.queryByRole("menuitemcheckbox", { name: /Salvar o desempate/ })).toBeNull()
    expect(screen.getByRole("menuitemcheckbox", { name: /Só diferenças/ })).toBeTruthy()
  })

  it("sem nada a oferecer, o gatilho do menu nem aparece", () => {
    // Bússola + free: nenhuma das três opções se aplica.
    renderToolbar({ view: "bussola", showBussola: true, isPaid: false })
    expect(screen.queryByLabelText("Mais opções de exibição")).toBeNull()
  })

  it("com uma obra só não há desempate nem troca de vista", () => {
    renderToolbar({ canRerank: false, canSwitchView: false, differentialsCount: 0 })
    expect(screen.queryByText("Desempatar com IA")).toBeNull()
    expect(screen.queryByText("Bússola")).toBeNull()
    expect(screen.queryByLabelText("Mais opções de exibição")).toBeNull()
    // O que sobra continua fazendo sentido: escolher linhas, limpar e fechar.
    expect(screen.getByText("Linhas")).toBeTruthy()
    expect(screen.getByText("Limpar")).toBeTruthy()
  })
})

describe("topo da comparação: 'Onde diferenciam' é disclosure", () => {
  it("mostra o contador e anuncia o estado fechado", () => {
    renderToolbar()
    const btn = screen.getByRole("button", { name: /Onde diferenciam/ })
    expect(btn.getAttribute("aria-expanded")).toBe("false")
    expect(btn.getAttribute("aria-controls")).toBe("compare-differentials")
    expect(btn.textContent).toContain("3")
  })

  it("chama o toggle no clique e anuncia aberto", () => {
    const onToggle = vi.fn()
    renderToolbar({ onToggleDifferentials: onToggle, differentialsOpen: true })
    const btn = screen.getByRole("button", { name: /Onde diferenciam/ })
    expect(btn.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("some quando não há critério divergente, e na Bússola", () => {
    renderToolbar({ differentialsCount: 0 })
    expect(screen.queryByRole("button", { name: /Onde diferenciam/ })).toBeNull()
    cleanup()
    renderToolbar({ view: "bussola", showBussola: true })
    expect(screen.queryByRole("button", { name: /Onde diferenciam/ })).toBeNull()
  })
})
