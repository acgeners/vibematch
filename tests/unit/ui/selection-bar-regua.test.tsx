import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const perms = { canWriteOwnState: true }
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => perms.canWriteOwnState,
}))

import { CompareSelectionBar } from "@/components/titles/selection-bar"

/**
 * A régua da barra de seleção em massa, em RENDER.
 *
 * Ela é de render de propósito: o que regride nesta classe não é lógica, é o TRATAMENTO —
 * qual ação ficou vermelha, e se a versão estreita virou menu tendo um item só. Um teste que
 * varresse o source atrás de `text-rose-500` passaria com a cor na ação errada, que é
 * exatamente o bug que existia até 2026-08-08: "Remover do grupo" (reversível) era vermelho e
 * "Desfavoritar" (que esvazia as pastas sem volta) era neutro.
 */
const noop = () => {}

function renderBar(props: Partial<Parameters<typeof CompareSelectionBar>[0]> = {}) {
  return render(
    <CompareSelectionBar
      count={4}
      favoriteCount={4}
      onOpen={noop}
      onClear={noop}
      onUnfavorite={noop}
      onAddToGroup={noop}
      onRemoveFromGroup={noop}
      {...props}
    />
  )
}

/** Sobe do rótulo até o <button>, que é onde a classe de tom mora. */
function buttonFor(label: string | RegExp): HTMLElement {
  const el = screen.getByText(label)
  const btn = el.closest("button")
  if (!btn) throw new Error(`"${String(label)}" não está dentro de um <button>`)
  return btn
}

describe("barra de seleção: vermelho só no que não tem volta", () => {
  afterEach(() => {
    cleanup()
    perms.canWriteOwnState = true
  })

  it("pinta de vermelho o desfavoritar, e NÃO o tirar do grupo", () => {
    renderBar()
    expect(buttonFor(/Desfavoritar 4/).className).toMatch(/rose/)
    expect(buttonFor("Tirar do grupo").className).not.toMatch(/rose/)
  })

  it("não pinta de vermelho nenhuma ação da zona de usar a seleção", () => {
    renderBar()
    // `destructive` sozinho não serve de sonda: a classe BASE do Button já traz
    // `aria-invalid:border-destructive`, que não é tom nenhum.
    expect(buttonFor("Comparar").className).not.toMatch(/rose|text-destructive/)
    expect(buttonFor("Adicionar a grupo").className).not.toMatch(/rose|text-destructive/)
  })

  it("mantém o limpar seleção colado no contador", () => {
    renderBar({ count: 3, favoriteCount: 3 })
    const contador = screen.getByText("3")
    const limpar = screen.getByLabelText("Limpar seleção")
    // Mesmo container: solto na outra ponta da barra ele não dizia o que ia limpar.
    expect(contador.parentElement?.contains(limpar)).toBe(true)
  })

  it("desabilita o Comparar acima do teto, sem esconder o botão", () => {
    renderBar({ count: 11, favoriteCount: 11 })
    expect(buttonFor("Comparar").hasAttribute("disabled")).toBe(true)
  })

  it("some inteira com zero selecionadas", () => {
    const { container } = renderBar({ count: 0, favoriteCount: 0 })
    expect(container.innerHTML).toBe("")
  })
})

describe("barra de seleção: a zona de retirar degrada sem virar menu de um item", () => {
  afterEach(() => {
    cleanup()
    perms.canWriteOwnState = true
  })

  it("fora de um grupo, a versão estreita é botão-ícone e não dropdown", () => {
    // /titles, /ranking e "Todos os favoritos" não têm de onde remover: sobra o desfavoritar.
    renderBar({ onRemoveFromGroup: undefined })
    expect(screen.queryByLabelText("Mais ações")).toBeNull()
    expect(screen.getByLabelText("Desfavoritar 4")).toBeTruthy()
  })

  it("dentro de um grupo, a versão estreita recolhe as DUAS num menu", () => {
    renderBar()
    expect(screen.getByLabelText("Mais ações")).toBeTruthy()
  })

  it("sem permissão de escrever estado próprio, a zona de retirar não existe", () => {
    perms.canWriteOwnState = false
    renderBar()
    expect(screen.queryByText(/Desfavoritar/)).toBeNull()
    expect(screen.queryByText("Tirar do grupo")).toBeNull()
    expect(screen.queryByLabelText("Mais ações")).toBeNull()
    // …mas comparar continua: é leitura, não depende de papel.
    expect(screen.getByText("Comparar")).toBeTruthy()
  })
})
