import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

/**
 * Botão "Recalcular notas" quando o guard de código canônico recusa (server/recalc/code-guard.ts).
 *
 * 🔴 RENDER de propósito: o ramo antigo de falha imprimia "O recálculo falhou. Tente novamente." e
 * ignorava o texto do erro. A recusa só é compreensível se a MENSAGEM do servidor chega ao toast —
 * um teste da action passaria verde com a tela dizendo "tente novamente", que não resolve nada.
 */

const MSG =
  "Recálculo da nuvem BLOQUEADO: este checkout local não está no código canônico — o HEAD não está " +
  "contido em origin/main. Checkout: fix/experimento @ bbbbbbb. Nada foi calculado nem gravado, e o " +
  "recálculo continua pendente. Rode-o a partir de um checkout limpo contido em origin/main (código já mergeado)."

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("sonner", () => ({ toast: h.toast }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))
vi.mock("@/server/actions/recalc-queue", () => ({
  triggerRecalcNow: async () => ({ status: "blocked", error: MSG }),
  getAiPendingCounts: async () => ({ embeddings: 0, canonicalSynopsis: 0, reviewSummary: 0 }),
}))

import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"

beforeEach(() => {
  h.toast.success.mockReset()
  h.toast.error.mockReset()
  h.toast.info.mockReset()
})

describe("recálculo recusado pelo guard de código", () => {
  it("o toast mostra a mensagem do servidor — e o botão fica, porque a pendência continua", async () => {
    render(<RecalcPendingControl pending variant="compact" />)
    fireEvent.click(screen.getByRole("button", { name: /Recalcular notas/ }))

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled())
    expect(h.toast.error.mock.calls[0][0]).toBe(MSG)
    expect(h.toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Recalcular notas/ })).toBeTruthy()
  })
})
