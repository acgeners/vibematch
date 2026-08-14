import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"
import type { BalanceStatus } from "@/server/queries/ai-usage"

vi.mock("server-only", () => ({}))

import { NegativeBalanceDialog } from "@/components/layout/negative-balance-dialog"

function status(remainingUsd: number | null): BalanceStatus {
  return {
    balanceUsd: 17.17,
    setAt: "2026-07-27T21:04:15.282+00:00",
    spentSinceUsd: remainingUsd == null ? 0 : 17.17 - remainingUsd,
    remainingUsd,
    callsSince: 1448,
  }
}

const SESSION_KEY = "satoria.negative-balance.dismissed"

function isOpen(): boolean {
  return screen.queryByRole("dialog") != null
}

/**
 * O aviso de saldo negativo.
 *
 * 🔴 **A regra que regride é a FREQUÊNCIA, não o desenho.** Um modal que reabre a
 * cada navegação é indistinguível de um bug pra quem usa, e a diferença entre "abre
 * sempre" e "abre uma vez por sessão" some no meio de uma refatoração — nada quebra,
 * o aviso continua aparecendo. Por isso a dispensa é conferida pelos DOIS lados: que
 * ela grava, e que ela é respeitada.
 */
describe("aviso de saldo negativo", () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(cleanup)

  it("abre sozinho quando o saldo é negativo", () => {
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    expect(isOpen()).toBe(true)
    expect(screen.getByText(/Seu saldo da Anthropic está negativo/)).toBeDefined()
  })

  it("mostra a conta que produziu o número", () => {
    // Sem os três termos (informado − gasto = restante) o aviso é uma afirmação sem
    // origem, e a origem é justamente o que distingue "acabou o crédito" de "você
    // recarregou e não avisou o app".
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    expect(screen.getByText("$17,17")).toBeDefined()
    expect(screen.getByText("−$28,27")).toBeDefined()
    expect(screen.getByText("−$11,10")).toBeDefined()
  })

  it("leva pros dois lugares que resolvem: a Anthropic e o /ai-usage", () => {
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    const billing = screen.getByRole("link", { name: /Adicionar créditos/ })
    expect(billing.getAttribute("href")).toBe("https://platform.claude.com/settings/billing")
    // Sai do app: sem `noopener` a página de destino ganha acesso a `window.opener`.
    expect(billing.getAttribute("rel")).toContain("noopener")
    expect(
      screen.getByRole("link", { name: /Reinformar o saldo/ }).getAttribute("href"),
    ).toBe("/ai-usage")
  })

  it("saldo BAIXO não abre modal — âmbar informa, vermelho interrompe", () => {
    render(<NegativeBalanceDialog balance={status(1.4)} />)
    expect(isOpen()).toBe(false)
  })

  it("saldo nunca informado não abre modal", () => {
    render(<NegativeBalanceDialog balance={status(null)} />)
    expect(isOpen()).toBe(false)
  })

  it("dispensar grava a sessão, e a montagem seguinte não reabre", () => {
    const first = render(<NegativeBalanceDialog balance={status(-11.1)} />)
    fireEvent.click(screen.getByRole("button", { name: /Agora não/ }))
    expect(isOpen()).toBe(false)
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("1")

    // A "próxima navegação": mesma sessão, componente remontado, saldo ainda negativo.
    first.unmount()
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    expect(isOpen()).toBe(false)
  })

  it("fechar pelo X também vale como dispensa", () => {
    // ⚠️ Todo caminho de fechamento passa pelo `onOpenChange`. Se o X fechasse por
    // fora dele, a dispensa não gravaria e o modal voltaria na página seguinte —
    // exatamente o sintoma que a regra de frequência existe pra evitar.
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    fireEvent.click(screen.getByRole("button", { name: /Close/i }))
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("1")
  })

  it("a dispensa não sobrevive à sessão", () => {
    // `sessionStorage`, não `localStorage`: saldo negativo não se resolve com o tempo,
    // então "dispensei ontem" não pode significar "nunca mais me avise".
    window.sessionStorage.setItem(SESSION_KEY, "1")
    const dismissed = render(<NegativeBalanceDialog balance={status(-11.1)} />)
    expect(isOpen()).toBe(false)

    dismissed.unmount()
    window.sessionStorage.clear() // é o que o browser faz ao fechar a aba
    render(<NegativeBalanceDialog balance={status(-11.1)} />)
    expect(isOpen()).toBe(true)
  })
})
