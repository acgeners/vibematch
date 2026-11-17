import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

/**
 * Teste de RENDER das boas-vindas: os três defeitos aqui eram da TELA, não de regra pura.
 *   - "Pular" na tela de gostos não carregava o deck: a tela 4 ficava em "montando…" para sempre;
 *   - a tela de 18+ tinha "Pular", e pular era mostrar tudo sem a pessoa ter escolhido;
 *   - voltar à tela de notas somava de novo as notas já dadas ali.
 */

const deck = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Obra Um", totalChapters: 80, synopsis: "Sinopse um", coverUrls: [], genres: ["Romance"] },
  { id: "00000000-0000-4000-8000-000000000002", title: "Obra Dois", totalChapters: 40, synopsis: "Sinopse dois", coverUrls: [], genres: ["Fantasy"] },
]

const acoes = vi.hoisted(() => ({
  deckResposta: null as unknown,
  getOnboardingDeckAction: vi.fn(),
  getOnboardingProgressAction: vi.fn(async (excluir?: string[]) => (void excluir, { ok: true, ratedCount: 3 })),
  saveOnboardingTastes: vi.fn(async () => ({ ok: true })),
  deckSwipeAction: vi.fn(async () => ({ ok: true })),
  setHideAdultContent: vi.fn(async () => ({ error: null })),
  saveQuickScore: vi.fn(async () => ({ ok: true })),
  push: vi.fn(),
}))

vi.mock("@/server/actions/onboarding", () => ({
  saveOnboardingTastes: acoes.saveOnboardingTastes,
  getOnboardingDeckAction: acoes.getOnboardingDeckAction,
  deckSwipeAction: acoes.deckSwipeAction,
  getOnboardingProgressAction: acoes.getOnboardingProgressAction,
}))
vi.mock("@/server/actions/settings", () => ({ setHideAdultContent: acoes.setHideAdultContent }))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: acoes.saveQuickScore }))
vi.mock("@/components/import/external-list-import", () => ({ ExternalListImport: () => <div>importar</div> }))
vi.mock("@/components/ui/cover-image", () => ({ CoverImage: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: acoes.push }) }))

const { WelcomeFlow } = await import("@/app/welcome/welcome-flow")

const abrir = (props: Partial<React.ComponentProps<typeof WelcomeFlow>> = {}) =>
  render(<WelcomeFlow displayName="Ana" initialLoved={[]} initialVetos={[]} initialHideAdult={null} {...props} />)

const clicar = (nome: string | RegExp) => fireEvent.click(screen.getByRole("button", { name: nome }))

beforeEach(() => {
  vi.clearAllMocks()
  acoes.getOnboardingDeckAction.mockImplementation(async () => ({ ok: true, works: deck }))
})

describe("tela de 18+", () => {
  it("não tem 'Pular', e só segue depois de uma escolha", async () => {
    abrir()
    clicar(/Começar/)
    expect(screen.queryByRole("button", { name: "Pular" })).toBeNull()
    const seguir = screen.getByRole("button", { name: /Continuar/ })
    expect(seguir).toHaveProperty("disabled", true)
    clicar(/Ocultar obras adultas/)
    expect(seguir).toHaveProperty("disabled", false)
    clicar(/Continuar/)
    await waitFor(() => expect(acoes.setHideAdultContent).toHaveBeenCalledWith(true))
  })
})

describe("deck", () => {
  async function irAteGostos() {
    abrir({ initialHideAdult: false })
    clicar(/Começar/)
    clicar(/Continuar/)
    await screen.findByText(/O que te atrai/)
  }

  it("'Pular' na tela de gostos carrega o deck — sem gravar gostos", async () => {
    await irAteGostos()
    clicar("Pular")
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    expect(acoes.getOnboardingDeckAction).toHaveBeenCalledTimes(1)
    expect(acoes.saveOnboardingTastes).not.toHaveBeenCalled()
  })

  it("erro ao montar o deck mostra o erro e deixa tentar de novo", async () => {
    acoes.getOnboardingDeckAction.mockImplementationOnce(async () => ({ ok: false, error: "caiu" }))
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    await irAteGostos()
    clicar("Pular")
    await screen.findByText(/Não consegui montar o deck/)
    clicar("Tentar de novo")
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    erro.mockRestore()
  })

  it("deck vazio diz que acabou, em vez de 'montando…' para sempre", async () => {
    acoes.getOnboardingDeckAction.mockImplementationOnce(async () => ({ ok: true, works: [] }))
    await irAteGostos()
    clicar("Pular")
    await screen.findByText(/Nenhuma obra nova/)
    expect(screen.queryByText(/montando o seu deck/)).toBeNull()
  })
})

describe("medidor de notas", () => {
  it("o servidor conta só as notas que a tela NÃO está contando (sem somar duas vezes)", async () => {
    abrir({ initialHideAdult: false })
    clicar(/Começar/)
    clicar(/Continuar/)
    await screen.findByText(/O que te atrai/)
    clicar("Pular")
    await screen.findByText("Obra Um")
    clicar("Já li")
    await waitFor(() => expect(acoes.deckSwipeAction).toHaveBeenCalled())
    // espera a animação do swipe terminar antes de seguir
    await new Promise((r) => setTimeout(r, 250))
    clicar(/Continuar/) // → importar
    clicar(/Continuar/) // → notas
    await screen.findByText(/Quanto você gostou/)
    fireEvent.click(screen.getAllByRole("button", { name: "8" })[0])
    expect(acoes.getOnboardingProgressAction).toHaveBeenLastCalledWith([])

    clicar("Voltar")
    clicar(/Continuar/)
    await screen.findByText(/Quanto você gostou/)
    expect(acoes.getOnboardingProgressAction).toHaveBeenLastCalledWith([deck[0].id])
    // 3 do servidor (sem esta) + 1 da tela = 4, e não 5.
    expect(screen.getByText("de 20").previousElementSibling?.textContent).toBe("4")
  })
})
