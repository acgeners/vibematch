import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("@/server/actions/ai", () => ({
  triggerAiEvaluation: vi.fn(),
  skipAiEvaluation: vi.fn(),
  prewarmEvaluationContext: vi.fn(),
  loadAiEvaluationForReview: vi.fn(),
}))
vi.mock("@/server/actions/comix-resolver", () => ({ getComixHealthStatus: vi.fn(async () => null) }))
vi.mock("@/server/actions/ai-eval-read", () => ({ markAiEvalRead: vi.fn(), unmarkAiEvalRead: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen } from "@testing-library/react"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"

/**
 * A fila "Reviews novas" só dizia SIM/NÃO — 770 obras com a mesma marca, sem dizer quais tinham
 * mudado de verdade. O card agora diz QUANTO: "+N reviews desde a avaliação (tinha M)".
 *
 * Teste de RENDER de propósito: um teste que lesse o objeto da obra passaria verde com o número
 * fora da tela, que é exatamente o estado de antes.
 */
function work(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    title: "Obra de teste",
    publication_status: "Ongoing",
    publication_status_id: 2,
    personal_status: "Reading",
    personal_status_id: 3,
    matchedFilters: ["outdated-reviews"],
    aiEvalStatus: "done",
    reviewCount: 18,
    evaluation: {
      confidence: 0.8,
      modelName: "claude-sonnet-5",
      promptVersion: "v32",
      evaluatedAt: "2026-10-01T12:00:00Z",
    },
    ...over,
  }
}

describe("o crescimento de reviews no card da fila", () => {
  it("mostra quantas entraram desde a avaliação e quantas havia", () => {
    render(<AiEvaluationPanel pendingWorks={[work({ reviewGrowth: { newUseful: 12, before: 6 } })] as never} />)
    expect(screen.getByText("+12 reviews desde a avaliação (tinha 6)")).toBeTruthy()
  })

  it("o chip continua dizendo só 'Reviews novas' — o número mora na linha da avaliação", () => {
    render(<AiEvaluationPanel pendingWorks={[work({ reviewGrowth: { newUseful: 12, before: 6 } })] as never} />)
    expect(screen.getByText(/^Reviews novas$/)).toBeTruthy()
  })

  it("sem review nova (ou sem avaliação), a linha não aparece", () => {
    render(
      <AiEvaluationPanel
        pendingWorks={[
          work({ id: "w1", reviewGrowth: { newUseful: 0, before: 18 } }),
          work({ id: "w2", title: "Outra", reviewGrowth: null }),
        ] as never}
      />,
    )
    expect(screen.queryByText(/desde a avaliação/)).toBeNull()
  })
})
