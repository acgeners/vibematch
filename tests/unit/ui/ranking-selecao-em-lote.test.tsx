import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))

const perms = { canWriteOwnState: true }
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => perms.canWriteOwnState,
}))

import { CompareSelectionBar } from "@/components/titles/selection-bar"
import { MAX_COMPARE_WORKS, MAX_SELECTION_WORKS } from "@/lib/compare-config"

/**
 * As ações que a seleção do /ranking ganhou, em RENDER.
 *
 * De render de propósito: o que regride aqui é ESCOPO, não fórmula — quais ações
 * a barra oferece, para quantas obras, e se a de IA aparece numa página que não
 * passou os callbacks. Um teste que varresse o source atrás de `onRerank`
 * passaria com o botão nunca renderizado.
 */
const noop = () => {}

function renderBar(props: Partial<Parameters<typeof CompareSelectionBar>[0]> = {}) {
  return render(
    <CompareSelectionBar
      count={4}
      favoriteCount={1}
      onOpen={noop}
      onClear={noop}
      onUnfavorite={noop}
      {...props}
    />
  )
}

function buttonFor(label: string | RegExp): HTMLElement {
  const btn = screen.getByRole("button", { name: label })
  if (!btn) throw new Error(`"${String(label)}" não está num <button>`)
  return btn
}

afterEach(() => {
  cleanup()
  perms.canWriteOwnState = true
})

describe("zona de IA", () => {
  it("não existe na página que não passa os callbacks (o /titles)", () => {
    renderBar()
    expect(screen.queryByRole("button", { name: "Veredito IA" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Prever interesse" })).toBeNull()
  })

  it("aparece quando a página oferece as duas", () => {
    renderBar({ onRerank: noop, onPredictInterest: noop })
    expect(buttonFor("Veredito IA")).toBeTruthy()
    expect(buttonFor("Prever interesse")).toBeTruthy()
  })

  it("no plano Free desabilita COM o motivo — botão apagado sem explicação lê como quebrado", () => {
    renderBar({ onRerank: noop, onPredictInterest: noop, aiDisabledHint: "Feature do plano Pago." })
    const btn = buttonFor("Veredito IA")
    expect(btn).toHaveProperty("disabled", true)
    expect(btn.getAttribute("title")).toBe("Feature do plano Pago.")
  })
})

describe("teto: selecionar não é comparar", () => {
  it("acima de 10 a barra segue inteira e SÓ o Comparar desabilita", () => {
    // 🔴 A regressão que este teste guarda: usar MAX_COMPARE_WORKS como teto da
    // SELEÇÃO tornava as ações em lote inalcançáveis — o /ranking recusava a 11ª
    // marcação, então nunca dava pra mandar 12 obras pro Veredito.
    renderBar({ count: 12, favoriteCount: 3, onRerank: noop, onPredictInterest: noop })
    expect(buttonFor("Comparar")).toHaveProperty("disabled", true)
    expect(buttonFor("Veredito IA")).toHaveProperty("disabled", false)
    expect(screen.getByText("12")).toBeTruthy()
  })

  it("o teto do lote é MAIOR que o de comparar", () => {
    expect(MAX_SELECTION_WORKS).toBeGreaterThan(MAX_COMPARE_WORKS)
  })

  it("no limite do Comparar ele ainda funciona", () => {
    renderBar({ count: MAX_COMPARE_WORKS })
    expect(buttonFor("Comparar")).toHaveProperty("disabled", false)
  })
})

describe("Favoritar conta só o que muda", () => {
  it("mostra quantas AINDA NÃO são favoritas", () => {
    renderBar({ count: 10, favoriteCount: 4, onFavorite: noop })
    expect(buttonFor("Favoritar 6")).toBeTruthy()
  })

  it("some quando a seleção inteira já é favorita — o botão não teria efeito", () => {
    renderBar({ count: 5, favoriteCount: 5, onFavorite: noop })
    expect(screen.queryByRole("button", { name: /^Favoritar/ })).toBeNull()
  })

  it("Desfavoritar conta as favoritas, e é a única vermelha", () => {
    renderBar({ count: 10, favoriteCount: 4, onFavorite: noop })
    // A barra desenha DUAS versões (larga e estreita) e as duas ficam no DOM —
    // o vermelho tem que valer nas duas, senão ele some no mobile.
    const unfav = screen.getAllByRole("button", { name: /Desfavoritar 4/ })
    expect(unfav.length).toBeGreaterThan(0)
    for (const btn of unfav) expect(btn.className).toContain("text-rose-500")
    expect(buttonFor("Favoritar 6").className).not.toContain("text-rose-500")
  })

  it("sem permissão de escrever estado próprio, nenhuma das duas aparece", () => {
    perms.canWriteOwnState = false
    renderBar({ count: 10, favoriteCount: 4, onFavorite: noop })
    expect(screen.queryByRole("button", { name: /^Favoritar/ })).toBeNull()
    expect(screen.queryAllByRole("button", { name: /Desfavoritar/ })).toHaveLength(0)
  })
})
