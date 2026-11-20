import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const acoes = vi.hoisted(() => ({ setHideAdultContent: vi.fn(async () => ({ error: null })) }))
vi.mock("@/server/actions/settings", () => ({ setHideAdultContent: acoes.setHideAdultContent }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { HideAdultContentToggle } = await import("@/components/settings/hide-adult-content-toggle")

beforeEach(() => vi.clearAllMocks())

/**
 * Ligar o conteúdo adulto em Preferências pede a idade, como nas boas-vindas (19/11/2026): sem isto,
 * Preferências era o atalho que dispensava a confirmação.
 */
describe("mostrar conteúdo adulto em Preferências", () => {
  it("ligar pede a idade; 'Voltar' não muda nada", async () => {
    render(<HideAdultContentToggle initialHidden />)
    fireEvent.click(screen.getByRole("switch"))
    expect(await screen.findByText("Você tem 18 anos ou mais?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }))
    expect(acoes.setHideAdultContent).not.toHaveBeenCalled()
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false")
  })

  it("confirmar a idade liga", async () => {
    render(<HideAdultContentToggle initialHidden />)
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(await screen.findByRole("button", { name: "Tenho 18 anos ou mais" }))
    await waitFor(() => expect(acoes.setHideAdultContent).toHaveBeenCalledWith(false))
  })

  it("desligar não pergunta nada", async () => {
    render(<HideAdultContentToggle initialHidden={false} />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() => expect(acoes.setHideAdultContent).toHaveBeenCalledWith(true))
    expect(screen.queryByText("Você tem 18 anos ou mais?")).toBeNull()
  })
})
