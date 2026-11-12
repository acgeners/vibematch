import { vi, describe, it, expect } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/titles/curation-request-panel", () => ({ RequestByNameBanner: () => null }))
vi.mock("@/lib/external/client-fetches", () => ({ fetchComicKClient: vi.fn(), fetchAnimePlanetClient: vi.fn() }))
vi.mock("@/server/actions/comix-resolver", () => ({ validateComixHid: vi.fn() }))
vi.mock("@/server/actions/external", () => ({
  // A busca da Comix é gateada por token: o candidato nunca traz a Comix.
  searchExternalTitles: vi.fn(async () => ({
    candidates: [{ title: "Obra Nova", sources: ["mangaupdates"], muId: 61294752209, matchScore: 1 }],
    failedSources: [],
  })),
  fetchExternalData: vi.fn(),
  upsertExternalTags: vi.fn(),
  checkExistingWorkInDb: vi.fn(async () => []),
  evaluateCandidateForCreate: vi.fn(),
}))

import { ExternalSearch } from "@/components/titles/external-search"

/**
 * Em 12/11 três obras foram criadas no localhost:3000 sem a Comix. O passo de fontes da criação
 * ESCONDIA o bloco da Comix (com o campo de colar o hid) sempre que o sidecar estava configurado —
 * que é justamente o localhost:3000 —, na premissa de que a descoberta por cross-ID resolveria
 * sozinha. Quando ela não casava, não havia onde colar o hid.
 *
 * Teste de RENDER: o que regride é o campo sumir da tela. O caminho é o real (buscar → "Usar").
 */
describe("criação — o campo de hid da Comix no passo de fontes", () => {
  it("🔴 aparece, mesmo sem a Comix ter vindo na busca", async () => {
    render(<ExternalSearch titleQuery="Obra Nova" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /Buscar dados/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Usar" }))
    expect(await screen.findByPlaceholderText("hid ou URL da comix.to")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Validar e adicionar" })).toBeTruthy()
  })
})

describe("criação — o hid colado não se perde em silêncio", () => {
  async function chegarAoPassoDeFontes() {
    render(<ExternalSearch titleQuery="Obra Nova" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /Buscar dados/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Usar" }))
    return screen.findByPlaceholderText("hid ou URL da comix.to")
  }
  const seguir = () => screen.getByRole("button", { name: "Buscar dados dessas fontes" })

  it("🔴 hid colado e não adicionado TRAVA o seguir, e a tela diz o que falta", async () => {
    const campo = await chegarAoPassoDeFontes()
    expect(seguir()).toHaveProperty("disabled", false)
    fireEvent.change(campo, { target: { value: "abc12" } })
    expect(seguir()).toHaveProperty("disabled", true)
    expect(screen.getByText(/Há um hid da Comix colado/)).toBeTruthy()
    fireEvent.change(campo, { target: { value: "" } })
    expect(seguir()).toHaveProperty("disabled", false)
  })

  it("🔴 o hid validado chega na busca de dados da obra", async () => {
    const { validateComixHid } = await import("@/server/actions/comix-resolver")
    vi.mocked(validateComixHid).mockResolvedValue({ ok: true, hid: "abc12", title: "Obra Nova" } as never)
    const { fetchExternalData } = await import("@/server/actions/external")
    const campo = await chegarAoPassoDeFontes()
    fireEvent.change(campo, { target: { value: "abc12" } })
    fireEvent.click(screen.getByRole("button", { name: "Validar e adicionar" }))
    await waitFor(() => expect(seguir()).toHaveProperty("disabled", false))
    fireEvent.click(seguir())
    await waitFor(() => expect(fetchExternalData).toHaveBeenCalled())
    expect(vi.mocked(fetchExternalData).mock.calls[0][0]).toMatchObject({ comixHid: "abc12" })
  })
})
