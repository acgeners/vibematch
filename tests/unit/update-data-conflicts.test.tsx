import { vi, describe, it, expect, beforeEach } from "vitest"

// O SynopsisPicker mede a largura do card pra decidir o clamp — o jsdom não traz
// ResizeObserver e o efeito derruba a árvore inteira antes de chegar nos conflitos.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock("server-only", () => ({}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/lib/external/client-fetches", () => ({
  fetchComicKClient: vi.fn(async () => null),
  fetchAnimePlanetClient: vi.fn(async () => null),
}))

const refreshWorkExternalData = vi.fn()
const updateWorkExternalData = vi.fn(async () => ({ data: { id: "w1", slug: "obra" } }))
vi.mock("@/server/actions/works", () => ({
  refreshWorkExternalData: (...a: unknown[]) => refreshWorkExternalData(...a),
  updateWorkExternalData: (...a: unknown[]) => updateWorkExternalData(...a),
}))

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import type { ExternalWorkData } from "@/lib/external/types"

/** Obra salva: 50 capítulos, em andamento — o caso real do Cliterary Book Club. */
const CURRENT_WORK = {
  title: "Cliterary Book Club",
  totalChapters: 50,
  publicationStatus: "Ongoing",
  synopsis: "Sinopse salva.",
}

/**
 * Resposta do refresh: o merge escolheu o 1 do MangaDex (primeiro da fila a
 * responder) enquanto o MangaUpdates diz 50 — igual ao valor salvo.
 */
function externalData(overrides: Partial<ExternalWorkData> = {}): ExternalWorkData {
  return {
    title: "Cliterary Book Club",
    totalChapters: 1,
    genres: [],
    tags: [],
    multiSynopses: [{ source: "mangadex", text: "Sinopse salva." }],
    fieldProvenance: {
      totalChapters: [
        { value: 1, sources: ["mangadex"] },
        { value: 50, sources: ["mangaupdates"] },
      ],
    },
    ...overrides,
  }
}

/** Abre o diálogo e avança até o passo de conflitos. */
async function openToConflicts(data: ExternalWorkData) {
  refreshWorkExternalData.mockResolvedValue({ ok: true, data, conflicts: [], sources: [] })
  render(<UpdateDataDialog workId="w1" currentWork={CURRENT_WORK} open onOpenChange={() => {}} hideTrigger />)
  const continuar = await screen.findByRole("button", { name: "Continuar" })
  fireEvent.click(continuar)
  await screen.findByRole("button", { name: "Confirmar e salvar" })
}

/** Linhas (radios + texto) do campo cujo rótulo é `label`. */
function rowsOf(label: string): string[] {
  const heading = screen.getByText(label)
  const field = heading.parentElement as HTMLElement
  return within(field)
    .getAllByRole("radio")
    .map((radio) => (radio.closest("label") as HTMLElement).textContent?.replace(/\s+/g, " ").trim() ?? "")
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Atualizar dados externos — passo de conflitos", () => {
  it("nomeia a fonte no lugar de 'Externo'", async () => {
    await openToConflicts(externalData())
    const rows = rowsOf("Capítulos totais")
    expect(rows.some((r) => r.includes("MangaDex") && r.includes("1"))).toBe(true)
    expect(rows.every((r) => !r.includes("Externo"))).toBe(true)
  })

  it("não repete o valor salvo como opção externa (o 50 do MangaUpdates)", async () => {
    await openToConflicts(externalData())
    const rows = rowsOf("Capítulos totais")
    // Duas linhas: o 1 do MangaDex e o Atual. O 50 do MangaUpdates coincide com o
    // salvo — vira o próprio "Atual", não uma terceira linha idêntica.
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.includes("50"))).toHaveLength(1)
    expect(rows.some((r) => r.includes("MangaUpdates"))).toBe(false)
  })

  it("agrupa numa linha só as fontes que concordam entre si", async () => {
    await openToConflicts(
      externalData({
        publicationStatus: "Completed",
        fieldProvenance: {
          publicationStatus: [
            { value: "Completed", sources: ["mangaupdates", "anilist"] },
            { value: "Cancelled", sources: ["comick"] },
          ],
        },
      })
    )
    const rows = rowsOf("Status de publicação")
    expect(rows).toHaveLength(3)
    const completed = rows.find((r) => r.includes("Completed")) ?? ""
    expect(completed).toContain("MangaUpdates")
    expect(completed).toContain("AniList")
    expect(rows.some((r) => r.includes("ComicK") && r.includes("Cancelled"))).toBe(true)
  })

  it("cai em 'Externo' quando o valor não tem fonte atribuível", async () => {
    await openToConflicts(externalData({ fieldProvenance: {} }))
    const rows = rowsOf("Capítulos totais")
    expect(rows.some((r) => r.includes("Externo") && r.includes("1"))).toBe(true)
  })

  it("salva o valor da fonte escolhida, não o que venceu o merge", async () => {
    await openToConflicts(
      externalData({
        totalChapters: 1,
        fieldProvenance: {
          totalChapters: [
            { value: 1, sources: ["mangadex"] },
            { value: 30, sources: ["mangaupdates"] },
          ],
        },
      })
    )
    // Escolhe explicitamente o 30 do MangaUpdates (o merge tinha escolhido o 1).
    const heading = screen.getByText("Capítulos totais")
    const field = heading.parentElement as HTMLElement
    const mangaupdatesRow = within(field)
      .getAllByRole("radio")
      .find((radio) => (radio.closest("label") as HTMLElement).textContent?.includes("MangaUpdates"))
    fireEvent.click(mangaupdatesRow as HTMLElement)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e salvar" }))

    await waitFor(() => expect(updateWorkExternalData).toHaveBeenCalledTimes(1))
    expect(updateWorkExternalData.mock.calls[0][1]).toMatchObject({ totalChapters: 30 })
  })

  it("mantém o pré-selecionado no valor que venceu o merge", async () => {
    await openToConflicts(externalData())
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e salvar" }))
    await waitFor(() => expect(updateWorkExternalData).toHaveBeenCalledTimes(1))
    expect(updateWorkExternalData.mock.calls[0][1]).toMatchObject({ totalChapters: 1 })
  })
})
