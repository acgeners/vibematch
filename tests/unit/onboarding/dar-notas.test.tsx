import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const deck = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Obra Um", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null },
  { id: "00000000-0000-4000-8000-000000000002", title: "Obra Dois", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null },
]
const jaLida = { id: "00000000-0000-4000-8000-000000000009", title: "Lida Antes", totalChapters: 40, synopsis: "", coverUrls: [], genres: [], platformAvg: null, totalVotes: null }

const acoes = vi.hoisted(() => ({
  getOnboardingDeckAction: vi.fn(),
  deckSwipeAction: vi.fn(async () => ({ ok: true })),
  removeOnboardingWorkAction: vi.fn(async () => ({ ok: true })),
  setOnboardingReadingAction: vi.fn(async () => ({ ok: true, canRate: true })),
  saveQuickScore: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/server/actions/onboarding", () => ({
  getOnboardingDeckAction: acoes.getOnboardingDeckAction,
  deckSwipeAction: acoes.deckSwipeAction,
  removeOnboardingWorkAction: acoes.removeOnboardingWorkAction,
  setOnboardingReadingAction: acoes.setOnboardingReadingAction,
}))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: acoes.saveQuickScore }))
vi.mock("@/components/ui/cover-image", () => ({ CoverImage: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

const { RatePage } = await import("@/components/onboarding/rate-page")

beforeEach(() => {
  vi.clearAllMocks()
  acoes.getOnboardingDeckAction.mockImplementation(async () => ({ ok: true, works: deck }))
})

/** A página "Dar notas": o mesmo deck e a mesma lista de notas das boas-vindas. */
describe("Dar notas", () => {
  it("'Já li' no deck põe a obra no TOPO da lista, marcada como do deck", async () => {
    render(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} />)
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    const linhas = screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))
    expect(linhas).toEqual(["Nota para Obra Um", "Nota para Lida Antes"])
    expect(screen.getByText("DO DECK, AGORA")).toBeTruthy()
  })

  it("a nota dada aqui soma no ensō; 'Desfazer última' tira a obra da lista", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(within(screen.getByRole("group", { name: "Nota para Lida Antes" })).getByRole("button", { name: "8" }))
    expect(screen.getByLabelText("Progresso da Nota Prevista").textContent).toMatch(/^5de 20/)
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    fireEvent.click(screen.getByRole("button", { name: /Desfazer última/ }))
    expect(screen.queryByRole("group", { name: "Nota para Obra Um" })).toBeNull()
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
  })
})
