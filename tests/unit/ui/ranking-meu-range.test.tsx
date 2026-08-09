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
import type { IdealRange } from "@/lib/ranking/my-range"

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const RANGES: Record<string, IdealRange> = {
  romance: { ideal_min: 7, ideal_max: 9.5, weight: 0.9 },
  couple_dynamics: { ideal_min: 6.5, ideal_max: 9, weight: 0.8 },
  drama: { ideal_min: 5.5, ideal_max: 8.5, weight: 0.6 },
}

/**
 * O controle "Meu range", em RENDER.
 *
 * De render de propósito: `my-range.test.ts` já cobre a fórmula e passava verde
 * enquanto o controle não estava LIGADO em lugar nenhum. O que regride nesta
 * classe é o escopo — se ele aparece, e se aparece pra quem não tem perfil.
 */
function renderFilters(props: Partial<Parameters<typeof RankingFilters>[0]> = {}) {
  return render(
    <RankingFilters
      availableGenres={[]}
      availableTags={[]}
      defaultTopN={40}
      defaultSort="expected_score:desc"
      {...props}
    />
  )
}

/** Vai pra aba Notas, onde o controle vive.
 *  ⚠️ `mouseDown`, não `click`: o Tabs do Radix ativa no mousedown/focus, e um
 *  `click` deixa o painel sem montar — o teste falharia por infraestrutura. */
function openNotas() {
  const tab = screen.getByRole("tab", { name: "Notas" })
  fireEvent.mouseDown(tab)
  fireEvent.focus(tab)
}

afterEach(() => {
  cleanup()
  nav.replace.mockClear()
})

describe("quando aparece", () => {
  it("some sem perfil de gosto — mesma condição do modo de cor 'Minha faixa'", () => {
    renderFilters()
    openNotas()
    expect(screen.queryByText("Meu range")).toBeNull()
  })

  it("some quando o perfil existe mas não opina sobre nada (peso ~0)", () => {
    renderFilters({ criterionRanges: { romance: { ideal_min: 7, ideal_max: 9.5, weight: 0 } } })
    openNotas()
    expect(screen.queryByText("Meu range")).toBeNull()
  })

  it("aparece com as faixas, e começa desligado", () => {
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    expect(screen.getByText("Meu range")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Desligado" }).getAttribute("aria-pressed")).toBe("true")
  })
})

describe("os degraus", () => {
  it("são dois, do mais frouxo pro mais estrito", () => {
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    // ±2,5 foi cortado por medição: não derruba nenhuma das 40 do topo.
    expect(screen.getByRole("button", { name: "Com folga" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Exata" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Ampla/ })).toBeNull()
  })

  it("clicar marca o degrau — o estado sai da URL de rascunho, não de state paralelo", () => {
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    fireEvent.click(screen.getByRole("button", { name: "Exata" }))
    expect(screen.getByRole("button", { name: "Exata" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Desligado" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("trocar de degrau reescreve os limiares em vez de somar dois recortes", () => {
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    fireEvent.click(screen.getByRole("button", { name: "Exata" }))
    fireEvent.click(screen.getByRole("button", { name: "Com folga" }))
    expect(screen.getByRole("button", { name: "Com folga" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Exata" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("desligar volta ao estado inicial", () => {
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    fireEvent.click(screen.getByRole("button", { name: "Exata" }))
    fireEvent.click(screen.getByRole("button", { name: "Desligado" }))
    expect(screen.getByRole("button", { name: "Desligado" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Exata" }).getAttribute("aria-pressed")).toBe("false")
  })
})

describe("é RASCUNHO, como o resto do painel", () => {
  it("clicar num degrau NÃO navega — quem navega é o 'Aplicar filtros'", () => {
    // 🔴 Navegar por fora do rascunho é o bug documentado do "Esconder tags
    // evitadas": o Aplicar seguinte reescreve a query inteira a partir de uma
    // foto que não conhece a mudança, e o filtro some sem erro.
    renderFilters({ criterionRanges: RANGES })
    openNotas()
    fireEvent.click(screen.getByRole("button", { name: "Exata" }))
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
