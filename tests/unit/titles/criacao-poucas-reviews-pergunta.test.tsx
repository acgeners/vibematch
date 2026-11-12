import { vi, describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
const info = vi.fn()
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: (...a: unknown[]) => info(...a) } }))
vi.mock("@/components/titles/curation-request-panel", () => ({ RequestByNameBanner: () => null }))
vi.mock("@/lib/external/client-fetches", () => ({ fetchComicKClient: vi.fn(async () => null), fetchAnimePlanetClient: vi.fn(async () => null) }))
vi.mock("@/server/actions/comix-resolver", () => ({ validateComixHid: vi.fn() }))
vi.mock("@/server/actions/external", () => ({
  searchExternalTitles: vi.fn(async () => ({
    candidates: [{ title: "Obra Nova", sources: ["mangaupdates"], muId: 1, matchScore: 1 }],
    failedSources: [],
  })),
  fetchExternalData: vi.fn(async () => ({
    data: { title: "Obra Nova", genres: [], tags: [], externalIds: { mangaupdates: "1" } },
    conflicts: [],
  })),
  upsertExternalTags: vi.fn(async () => {}),
  checkExistingWorkInDb: vi.fn(async () => []),
  evaluateCandidateForCreate: vi.fn(async () => ({
    needsReviewConfirmation: true,
    noReviewsReason: "sources_returned_empty",
    fewReviews: { useful: 1, total: 3 },
  })),
}))

import { ExternalSearch } from "@/components/titles/external-search"
import { evaluateCandidateForCreate } from "@/server/actions/external"

/**
 * A pergunta da criação com poucas reviews úteis (medido em 2026-11-12: abaixo de 4 a avaliação
 * muda ~2,5× mais). Teste de RENDER: o que regride é o diálogo não mostrar a contagem, ou
 * "Deixar para depois" pagar a avaliação mesmo assim.
 */
beforeEach(() => {
  vi.clearAllMocks()
})

describe("criação — a pergunta das poucas reviews", () => {
  async function chegarNaPergunta(onSelect = vi.fn()) {
    render(<ExternalSearch titleQuery="Obra Nova" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole("button", { name: /Buscar dados/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Usar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Buscar dados dessas fontes" }))
    await screen.findByText("Poucas reviews para avaliar")
    return onSelect
  }

  it("🔴 mostra a contagem e oferece deixar para depois", async () => {
    await chegarNaPergunta()
    expect(screen.getByText(/3 reviews, 1 útil/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Deixar para depois" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Avaliar mesmo assim" })).toBeTruthy()
  })

  it("🔴 'Deixar para depois' cria sem notas e NÃO chama a avaliação de novo", async () => {
    const onSelect = await chegarNaPergunta()
    fireEvent.click(screen.getByRole("button", { name: "Deixar para depois" }))
    await waitFor(() => expect(onSelect).toHaveBeenCalled())
    expect(vi.mocked(evaluateCandidateForCreate)).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].criteriaScores).toBeUndefined()
    expect(info.mock.calls.at(-1)?.[0]).toMatch(/adiada/)
  })
})
