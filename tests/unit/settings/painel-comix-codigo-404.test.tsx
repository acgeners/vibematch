import { vi, describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/server/actions/comix-resolver", () => ({
  startComixResolver: vi.fn(),
  getComixResolverStatus: vi.fn(async () => ({ state: "idle" })),
  setComixHidManually: vi.fn(),
  markComixAbsent: vi.fn(),
  unmarkComixAbsent: vi.fn(),
}))

import { ResolveComixPanel } from "@/components/settings/resolve-comix-panel"

/**
 * O painel da Comix só via "sem código" e "não existe na Comix". Código que devolve 404 contava
 * como coberto: o card dizia "Com hid Comix 1074 · 100%" e "Nenhuma obra pendente" com 12 códigos
 * mortos (lote de capítulos de 11/11). Teste de RENDER: o que regride é a lista sumir da tela ou o
 * número de cobertura voltar a contar os mortos.
 */
const statusParado = { state: "idle" } as never

function renderizar(dead = [{ id: "d1", title: "Obra Morta", hid: "rg78m", notFoundAt: "2026-11-12T03:00:00Z" }]) {
  return render(
    <ResolveComixPanel
      accent="amber"
      initialStatus={statusParado}
      initialMissing={[{ id: "m1", title: "Obra Sem Código" }]}
      initialDead={dead}
      initialAbsent={[{ id: "a1", title: "Obra Ausente" }]}
      catalogTotal={100}
    />,
  )
}

const cartao = (rotulo: string) => screen.getByText(rotulo).parentElement as HTMLElement

describe("painel da Comix — código com 404", () => {
  it("🔴 'Funcionando' desconta os códigos mortos, e eles têm cartão próprio", () => {
    renderizar()
    // 100 − 1 sem código − 1 morto − 1 ignorada
    expect(within(cartao("Funcionando")).getByText("97")).toBeTruthy()
    expect(within(cartao("Código com 404")).getByText("1")).toBeTruthy()
  })

  it("lista a obra com o código morto, com o campo de código novo e o 'não existe'", () => {
    renderizar()
    expect(screen.getByText("Código não funciona (404)")).toBeTruthy()
    expect(screen.getByText("Obra Morta")).toBeTruthy()
    expect(screen.getByText("404 · rg78m")).toBeTruthy()
    // Duas linhas com campo: a da obra sem código e a da obra com 404.
    expect(screen.getAllByPlaceholderText("hid ou URL")).toHaveLength(2)
  })

  it("sem código morto, a lista não aparece e o cartão diz 0", () => {
    renderizar([])
    expect(screen.queryByText("Código não funciona (404)")).toBeNull()
    expect(within(cartao("Código com 404")).getByText("0")).toBeTruthy()
    expect(within(cartao("Funcionando")).getByText("98")).toBeTruthy()
  })
})

describe("o nome da obra abre a página dela", () => {
  it("em todas as listas, em aba nova — a fila não perde o lugar", () => {
    renderizar()
    for (const [titulo, id] of [["Obra Morta", "d1"], ["Obra Sem Código", "m1"], ["Obra Ausente", "a1"]] as const) {
      const link = screen.getByRole("link", { name: titulo, hidden: true })
      expect(link.getAttribute("href")).toBe(`/catalog/${id}`)
      expect(link.getAttribute("target")).toBe("_blank")
    }
  })
})
