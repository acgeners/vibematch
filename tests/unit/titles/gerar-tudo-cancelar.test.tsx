import { vi, describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/layout/admin-context", () => ({ useCan: () => true }))
vi.mock("@/components/titles/update-data-dialog", () => ({
  UpdateDataDialog: ({ open, onSaved }: { open: boolean; onSaved: () => void }) =>
    open ? <button onClick={onSaved}>salvar fontes</button> : null,
}))
vi.mock("@/lib/tasks-store", () => ({
  runTask: async ({ run, onDone }: { run: () => Promise<unknown>; onDone: (r: unknown) => void }) => onDone(await run()),
}))
const generateAllWorkData = vi.fn()
vi.mock("@/server/actions/generate-all", () => ({ generateAllWorkData: (...a: unknown[]) => generateAllWorkData(...a) }))

import { GenerateAllBanner } from "@/components/titles/generate-all-banner"

const PERGUNTA = {
  status: "needs_authorization",
  reason: "cost",
  estimatedUsd: 0.13,
  noReviewsReason: null,
  sources: null,
}

async function abrirPergunta(rotulo: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: rotulo }))
  fireEvent.click(await screen.findByRole("button", { name: "salvar fontes" }))
  await screen.findByText("Gerar todos os dados")
  expect(screen.getByText("aguardando autorização")).toBeTruthy()
}

beforeEach(() => {
  generateAllWorkData.mockReset()
  generateAllWorkData.mockResolvedValueOnce(PERGUNTA)
  generateAllWorkData.mockReturnValueOnce(new Promise(() => {})) // a fase paga não termina no teste
})

/**
 * Cancelar a pergunta do "Gerar tudo" devolve o botão ao estado de antes. Antes, a obra
 * ficava "aguardando autorização" até alguém rodar a cascata de novo.
 */
describe("Gerar tudo — cancelar a pergunta", () => {
  it("🔴 cancelar volta ao estado de antes (aqui, sem pílula)", async () => {
    render(<GenerateAllBanner compact workId="w1" workTitle="Obra" initialStatus="idle" currentWork={{} as never} />)
    await abrirPergunta(/Gerar tudo/)
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByText("aguardando autorização")).toBeNull())
    expect(screen.getByRole("button", { name: /Gerar tudo/ })).toBeTruthy()
  })

  it("🔴 obra que tinha concluído volta a 'concluído'", async () => {
    render(<GenerateAllBanner compact workId="w1" workTitle="Obra" initialStatus="done" currentWork={{} as never} />)
    await abrirPergunta(/Gerar de novo/)
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(await screen.findByText("concluído")).toBeTruthy()
    expect(screen.queryByText("aguardando autorização")).toBeNull()
  })

  it("🔴 confirmar NÃO volta: o diálogo fecha e a cascata segue", async () => {
    render(<GenerateAllBanner compact workId="w1" workTitle="Obra" initialStatus="idle" currentWork={{} as never} />)
    await abrirPergunta(/Gerar tudo/)
    fireEvent.click(screen.getByRole("button", { name: "Autorizar e gerar" }))
    expect(await screen.findByText("gerando")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Gerando/ })).toBeTruthy()
  })
})
