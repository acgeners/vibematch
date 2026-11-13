import { vi, describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/layout/admin-context", () => ({ useCan: () => true }))
// O passo de fontes do "Atualizar dados" é outro componente: aqui ele só "salva".
vi.mock("@/components/titles/update-data-dialog", () => ({
  UpdateDataDialog: ({ open, onSaved }: { open: boolean; onSaved: () => void }) =>
    open ? <button onClick={onSaved}>salvar fontes</button> : null,
}))
vi.mock("@/lib/tasks-store", () => ({
  runTask: async ({ run, onDone }: { run: () => Promise<unknown>; onDone: (r: unknown) => void }) => onDone(await run()),
}))
vi.mock("@/server/actions/generate-all", () => ({
  generateAllWorkData: vi.fn(async () => ({
    status: "needs_authorization",
    reason: "cost",
    estimatedUsd: 0.13,
    noReviewsReason: null,
    sources: null,
    fewReviews: { useful: 1, total: 3 },
  })),
}))

import { GenerateAllBanner } from "@/components/titles/generate-all-banner"

/**
 * A confirmação de custo do "Gerar tudo" com poucas reviews úteis. Teste de RENDER: o que
 * regride é o aviso sumir da tela e a cascata voltar a pedir só "Autorizar e gerar".
 */
describe("Gerar tudo — confirmação com poucas reviews", () => {
  it("🔴 mostra a contagem, diz que as notas são aceitas sem revisão e oferece deixar para depois", async () => {
    render(<GenerateAllBanner workId="w1" workTitle="Obra" initialStatus="idle" currentWork={{} as never} />)
    fireEvent.click(screen.getByRole("button", { name: /Gerar/ }))
    fireEvent.click(await screen.findByRole("button", { name: "salvar fontes" }))
    expect(await screen.findByText("Poucas reviews para gerar tudo")).toBeTruthy()
    expect(screen.getByText(/3 reviews, 1 útil/)).toBeTruthy()
    expect(screen.getByText(/aceitas sem revisão/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Deixar para depois" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Gerar mesmo assim" })).toBeTruthy()
  })
})
