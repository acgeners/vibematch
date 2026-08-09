import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const nav = { replace: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

import { RankingFilters } from "@/components/ranking/ranking-filters"

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

/**
 * Colapsar o painel pelo cabeçalho, em RENDER.
 *
 * De render de propósito: o estado vive num `useState` com o ⌃ já existente, então um
 * teste de source veria o `toggleCollapsed` declarado e passaria verde mesmo com o
 * handler não ligado no ícone nem no título — que é justamente o que a mudança faz.
 */
function renderFilters() {
  return render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort="expected_score:desc"
    />
  )
}

/** As abas só existem quando o painel está aberto — é o sinal de expandido/colapsado. */
const estaAberto = () => screen.queryByRole("tab", { name: "Geral" }) != null
const titulo = () => screen.getByRole("button", { name: "Filtros" })
const icone = () => document.querySelector('[role="presentation"]') as HTMLElement

afterEach(() => {
  cleanup()
  nav.replace.mockClear()
  window.localStorage.clear()
})

describe("clicar no título colapsa e reabre", () => {
  it("começa aberto", () => {
    renderFilters()
    expect(estaAberto()).toBe(true)
  })

  it("um clique no texto 'Filtros' colapsa; outro reabre", () => {
    renderFilters()
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(false)
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(true)
  })

  it("o título anuncia o estado (aria-expanded)", () => {
    renderFilters()
    expect(titulo().getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(titulo())
    expect(titulo().getAttribute("aria-expanded")).toBe("false")
  })

  it("o título continua sendo um heading — o botão vive DENTRO dele", () => {
    renderFilters()
    expect(screen.getByRole("heading", { name: "Filtros" })).toBeTruthy()
  })
})

describe("clicar no ícone faz o mesmo", () => {
  it("colapsa e reabre", () => {
    renderFilters()
    fireEvent.click(icone())
    expect(estaAberto()).toBe(false)
    fireEvent.click(icone())
    expect(estaAberto()).toBe(true)
  })

  /**
   * O ícone repete a ação do título ao lado. Se ele entrasse na ordem de tabulação,
   * quem navega por teclado ouviria "ocultar filtros" duas vezes seguidas antes de
   * chegar em qualquer filtro.
   */
  it("não entra na ordem de tabulação nem vira um segundo botão", () => {
    renderFilters()
    expect(icone().tagName).not.toBe("BUTTON")
    expect(icone().getAttribute("tabindex")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Filtros" })).toHaveLength(1)
  })
})

describe("o ⌃ original continua inteiro", () => {
  it("colapsa pelo ⌃ e reabre pelo título — é o mesmo estado", () => {
    renderFilters()
    fireEvent.click(screen.getByRole("button", { name: "Ocultar filtros" }))
    expect(estaAberto()).toBe(false)
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(true)
  })

  it("colapsado, o ⌃ vira 'Mostrar filtros' e o título segue clicável", () => {
    renderFilters()
    fireEvent.click(titulo())
    expect(screen.getByRole("button", { name: "Mostrar filtros" })).toBeTruthy()
    expect(titulo()).toBeTruthy()
  })
})
