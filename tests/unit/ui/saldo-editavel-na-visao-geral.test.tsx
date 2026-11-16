import { vi, describe, it, expect, beforeEach } from "vitest"

const setAnthropicBalance = vi.fn(async (_n: number) => ({ error: null as string | null }))
vi.mock("@/server/actions/account", () => ({ setAnthropicBalance: (n: number) => setAnthropicBalance(n) }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))

import { act, fireEvent, render, screen } from "@testing-library/react"
import { BalanceQuickEdit } from "@/components/curation/balance-quick-edit"

/**
 * Pedido de 16/11/2026: editar o saldo Anthropic direto na Visão Geral (`/curation`), sem ir a
 * "Uso da API IA". O formulário é o MESMO do cartão de lá (`BalanceForm`) — uma 2ª cópia
 * divergiria no separador decimal aceito.
 */
describe("saldo editável na Visão Geral", () => {
  beforeEach(() => setAnthropicBalance.mockClear())

  it("abre no lápis, aceita vírgula e grava; o popover fecha ao salvar", async () => {
    render(<BalanceQuickEdit balanceUsd={12.5} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar o saldo Anthropic" }))
    })
    const campo = screen.getByLabelText("Saldo Anthropic em USD") as HTMLInputElement
    expect(campo.value).toBe("12,5")
    await act(async () => {
      fireEvent.change(campo, { target: { value: "40,25" } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atualizar" }))
    })
    expect(setAnthropicBalance).toHaveBeenCalledWith(40.25)
    expect(screen.queryByLabelText("Saldo Anthropic em USD")).toBeNull()
  })

  it("valor inválido não grava e diz por quê", async () => {
    render(<BalanceQuickEdit balanceUsd={null} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar o saldo Anthropic" }))
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Saldo Anthropic em USD"), { target: { value: "-3" } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    })
    expect(setAnthropicBalance).not.toHaveBeenCalled()
    expect(screen.getByText(/Informe um valor válido/)).toBeTruthy()
  })
})
