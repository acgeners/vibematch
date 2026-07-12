import { vi, describe, it, expect, beforeEach } from "vitest"

// Server actions / módulos server-only não rodam no jsdom — mockados.
vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }))
vi.mock("@/server/actions/works", () => ({ updateWorkExternalData: vi.fn(), refreshWorkExternalData: vi.fn() }))
vi.mock("@/lib/external/client-fetches", () => ({ fetchComicKClient: vi.fn(), fetchAnimePlanetClient: vi.fn() }))
vi.mock("@/components/titles/external-search", () => ({ ExternalSearch: () => null }))

const revalidateWorkSources = vi.fn()
const saveWorkSourceSelections = vi.fn()
const isComixAutoResolveAvailable = vi.fn(async () => true)
vi.mock("@/server/actions/external", () => ({
  revalidateWorkSources: (...a: unknown[]) => revalidateWorkSources(...a),
  saveWorkSourceSelections: (...a: unknown[]) => saveWorkSourceSelections(...a),
  isComixAutoResolveAvailable: () => isComixAutoResolveAvailable(),
  setComixHidManually: vi.fn(),
}))

import { render, screen, waitFor } from "@testing-library/react"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"

const WORK = {
  id: "w1",
  title: "Growing the Seed of Evil",
  original_title: "Ak-ui Ssiat-eul Kiwo Beoryeotda",
  alternative_titles: ["I Have Grown the Seeds of Evil"],
} as never

describe("UpdateDataDialog — cabeçalho", () => {
  beforeEach(() => {
    revalidateWorkSources.mockResolvedValue({
      data: {
        query: "Growing the Seed of Evil",
        queriesUsed: ["Growing the Seed of Evil", "Ak-ui Ssiat-eul Kiwo Beoryeotda", "I Have Grown the Seeds of Evil"],
        candidatesPerSource: {},
        currentSelections: [],
      },
    })
  })

  it("mostra o nome da obra em negrito e os nomes usados na busca", async () => {
    render(<UpdateDataDialog workId="w1" currentWork={WORK} open onOpenChange={() => {}} hideTrigger withSourceStep />)

    const titulo = await screen.findByText("Growing the Seed of Evil", { selector: "p" })
    expect(titulo.className).toMatch(/font-semibold/)

    await waitFor(() => expect(screen.getByText(/Buscado nas fontes como/)).toBeTruthy())
    // as 3 variantes que a busca realmente usou (título + original + alternativo)
    expect(screen.getByText("Ak-ui Ssiat-eul Kiwo Beoryeotda")).toBeTruthy()
    expect(screen.getByText("I Have Grown the Seeds of Evil")).toBeTruthy()
  })

  it("não repete os nomes de busca dentro do passo de fontes", async () => {
    render(<UpdateDataDialog workId="w1" currentWork={WORK} open onOpenChange={() => {}} hideTrigger withSourceStep />)
    await waitFor(() => expect(screen.getByText(/Buscado nas fontes como/)).toBeTruthy())
    expect(screen.queryByText(/Busca usada/)).toBeNull()
  })

  it("descrição do topo é a versão curta", async () => {
    render(<UpdateDataDialog workId="w1" currentWork={WORK} open onOpenChange={() => {}} hideTrigger withSourceStep />)
    expect(screen.getByText(/Confirme as fontes e rebusque/)).toBeTruthy()
    expect(screen.queryByText(/deixa a obra igual a uma criada agora/)).toBeNull()
    expect(screen.queryByText(/Suas capas atuais já vêm marcadas/)).toBeNull()
  })
})
