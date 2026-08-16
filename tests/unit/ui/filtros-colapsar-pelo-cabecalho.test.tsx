import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const nav = { replace: vi.fn(), push: vi.fn() }
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/curation/works",
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

import { TitleFilters } from "@/components/titles/title-filters"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  nav.replace.mockClear()
  window.localStorage.clear()
})

const titulo = () => screen.getByRole("button", { name: "Filtros" })
const icone = () => document.querySelector('[role="presentation"]') as HTMLElement

/**
 * O mesmo gesto de colapso nos painéis de filtro das outras páginas, em RENDER.
 *
 * De render de propósito: o gatilho é um handler ligado a dois elementos do
 * cabeçalho — um teste de source veria `toggleCollapsed` declarado e passaria verde
 * com ele não ligado em lugar nenhum. O que regride aqui é o ESCOPO.
 */
describe("/catalog — o painel já colapsava pelo ⌃; agora também pelo cabeçalho", () => {
  const renderTitles = () =>
    render(<TitleFilters availableGenres={[]} availableTags={[]} />)

  /** O "Aplicar filtros" só existe com o painel aberto — é o sinal de estado. */
  const estaAberto = () => screen.queryByRole("button", { name: /Aplicar filtros/ }) != null

  it("clicar no título colapsa e reabre", () => {
    renderTitles()
    expect(estaAberto()).toBe(true)
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(false)
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(true)
  })

  it("clicar no ícone faz o mesmo", () => {
    renderTitles()
    fireEvent.click(icone())
    expect(estaAberto()).toBe(false)
  })

  it("o título anuncia o estado e continua sendo heading", () => {
    renderTitles()
    expect(titulo().getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(titulo())
    expect(titulo().getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("heading", { name: "Filtros" })).toBeTruthy()
  })

  it("o ⌃ e o cabeçalho mexem no MESMO estado", () => {
    renderTitles()
    fireEvent.click(screen.getByRole("button", { name: "Ocultar filtros" }))
    expect(estaAberto()).toBe(false)
    fireEvent.click(icone())
    expect(estaAberto()).toBe(true)
  })
})

describe("/curation/works e /my-ai-scores — o painel GANHOU colapso", () => {
  const renderAi = () =>
    render(
      <AiEvaluationFilters
        activeFilters={["pending"]}
        activePubStatuses={[]}
        activePersonalStatuses={[]}
      />
    )

  /** "Aplicar" e as seções só existem abertos; o cabeçalho fica sempre. */
  const estaAberto = () => screen.queryByRole("button", { name: /^Aplicar/ }) != null

  it("começa aberto e colapsa pelo título", () => {
    renderAi()
    expect(estaAberto()).toBe(true)
    fireEvent.click(titulo())
    expect(estaAberto()).toBe(false)
  })

  it("colapsa pelo ícone", () => {
    renderAi()
    fireEvent.click(icone())
    expect(estaAberto()).toBe(false)
  })

  it("ganhou o ⌃, que alterna o rótulo", () => {
    renderAi()
    expect(screen.getByRole("button", { name: "Ocultar filtros" })).toBeTruthy()
    fireEvent.click(titulo())
    expect(screen.getByRole("button", { name: "Mostrar filtros" })).toBeTruthy()
  })

  /**
   * Colapsado, o cabeçalho tem que continuar dizendo QUANTOS filtros estão ativos —
   * senão recolher o painel esconde o fato de a lista estar filtrada.
   */
  it("colapsado, o contador de filtros ativos continua visível", () => {
    renderAi()
    fireEvent.click(titulo())
    expect(screen.getByRole("heading", { name: "Filtros" })).toBeTruthy()
    expect(screen.getByText("1")).toBeTruthy()
  })

  it("o ícone não vira um segundo alvo de teclado", () => {
    renderAi()
    expect(icone().tagName).not.toBe("BUTTON")
    expect(screen.getAllByRole("button", { name: "Filtros" })).toHaveLength(1)
  })
})
