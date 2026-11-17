import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"
import { HIDE_AVOIDED_OFF, hideAvoidedOffValue, resolveHideAvoided } from "@/lib/tags/hide-avoided"
import { filterSegmentRole } from "@/lib/ui/filter-segment-tone"

/**
 * "Esconder as obras com tags que evito" virou PREFERÊNCIA da pessoa (migration 227), escolhida nas
 * boas-vindas ou em Preferências. Antes o filtro só valia enquanto o parâmetro estava na URL: quem
 * vetava isekai nas boas-vindas reencontrava o isekai no topo na visita seguinte.
 *
 * A régua: a URL manda; sem ela, a preferência. Com a preferência ligada, "sem parâmetro" já esconde,
 * e o "Não" grava `hide_avoided=off` para desligar numa visita.
 */

describe("o modo que vale", () => {
  it("sem parâmetro, a preferência decide", () => {
    expect(resolveHideAvoided(null, true)).toBe("all")
    expect(resolveHideAvoided(null, false)).toBe("off")
  })

  it("o parâmetro manda sobre a preferência, nos dois sentidos", () => {
    expect(resolveHideAvoided("off", true)).toBe("off")
    expect(resolveHideAvoided("strong", true)).toBe("strong")
    expect(resolveHideAvoided("all", false)).toBe("all")
  })

  it("valor desconhecido na URL cai na preferência", () => {
    expect(resolveHideAvoided("qualquer", true)).toBe("all")
    expect(resolveHideAvoided("qualquer", false)).toBe("off")
  })

  it("o 'Não' só grava valor quando a preferência está ligada — sem ela, limpa o parâmetro", () => {
    expect(hideAvoidedOffValue(true)).toBe(HIDE_AVOIDED_OFF)
    expect(hideAvoidedOffValue(false)).toBeNull()
  })

  it("o 'off' não corta nada: tom de selecionado, não o rosa de quem corta", () => {
    expect(filterSegmentRole(HIDE_AVOIDED_OFF)).toBe("selected")
  })
})

// ── O painel, em RENDER: é ele que pode desenhar "Não" sobre uma lista filtrada ──

vi.mock("server-only", () => ({}))
const nav = { replace: vi.fn() }
let currentQuery = ""
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(currentQuery),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

const { RankingFilters } = await import("@/components/ranking/ranking-filters")

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  nav.replace.mockClear()
  currentQuery = ""
})

function painel(query: string, preferHideAvoided: boolean) {
  currentQuery = query
  render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort="expected_score:desc"
      showHideAvoided
      preferHideAvoided={preferHideAvoided}
    />,
  )
}

const pressionado = (nome: string) => screen.getByRole("button", { name: nome }).getAttribute("aria-pressed")

function aplicarELer(): URLSearchParams {
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }))
  const url = nav.replace.mock.calls.at(-1)?.[0] as string
  return new URLSearchParams((url ?? "").split("?")[1] ?? "")
}

describe("o painel segue a preferência", () => {
  it("com a preferência ligada e sem parâmetro, mostra 'Todas' — a lista está filtrada", () => {
    painel("", true)
    expect(pressionado("Todas")).toBe("true")
    expect(pressionado("Não")).toBe("false")
  })

  it("com a preferência ligada, o 'Não' grava `off` (sem valor, a preferência voltaria a esconder)", () => {
    painel("", true)
    fireEvent.click(screen.getByRole("button", { name: "Não" }))
    expect(aplicarELer().get("hide_avoided")).toBe("off")
  })

  it("sem a preferência, nada muda: 'Não' marcado e limpando o parâmetro", () => {
    painel("hide_avoided=all", false)
    expect(pressionado("Todas")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Não" }))
    expect(aplicarELer().has("hide_avoided")).toBe(false)
  })
})
