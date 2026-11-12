import { vi, describe, it, expect } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/titles/curation-request-panel", () => ({ RequestByNameBanner: () => null }))
vi.mock("@/lib/external/client-fetches", () => ({ fetchComicKClient: vi.fn(), fetchAnimePlanetClient: vi.fn() }))
vi.mock("@/server/actions/comix-resolver", () => ({ validateComixHid: vi.fn() }))
vi.mock("@/server/actions/external", () => ({
  // A busca do Anime-Planet FALHOU (bypass sobrecarregado): a fonte vem em failedSources.
  searchExternalTitles: vi.fn(async () => ({
    candidates: [{ title: "Obra Nova", sources: ["mangaupdates"], muId: 1, matchScore: 1 }],
    failedSources: ["animeplanet"],
  })),
  fetchExternalData: vi.fn(async () => null),
  upsertExternalTags: vi.fn(),
  checkExistingWorkInDb: vi.fn(async () => []),
  evaluateCandidateForCreate: vi.fn(),
}))

import { ExternalSearch } from "@/components/titles/external-search"
import { fetchExternalData } from "@/server/actions/external"

/**
 * "Será re-tentada ao confirmar" era promessa só do ComicK. Hoje a fonte cuja busca falhou e que
 * ficou sem escolha vai no pedido da busca de dados (`retrySearchSources`), e o servidor a busca
 * de novo. Teste de RENDER: o que regride é o pedido deixar de sair do diálogo.
 */
describe("criação — fonte cuja busca falhou é buscada de novo ao confirmar", () => {
  it("🔴 o diálogo avisa a falha e pede a nova tentativa", async () => {
    render(<ExternalSearch titleQuery="Obra Nova" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /Buscar dados/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Usar" }))
    expect(await screen.findByText(/A busca falhou/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Buscar dados dessas fontes" }))
    await waitFor(() => expect(fetchExternalData).toHaveBeenCalled())
    expect(vi.mocked(fetchExternalData).mock.calls[0][0]).toMatchObject({ retrySearchSources: ["animeplanet"] })
  })
})
