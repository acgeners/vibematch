import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))

const loadAiEvaluationForReview = vi.fn()
vi.mock("@/server/actions/ai", () => ({
  triggerAiEvaluation: vi.fn(),
  skipAiEvaluation: vi.fn(),
  prewarmEvaluationContext: vi.fn(),
  loadAiEvaluationForReview: (...a: unknown[]) => loadAiEvaluationForReview(...a),
}))
vi.mock("@/server/actions/comix-resolver", () => ({ getComixHealthStatus: vi.fn(async () => null) }))
vi.mock("@/server/actions/ai-eval-read", () => ({
  markAiEvalRead: vi.fn(),
  unmarkAiEvalRead: vi.fn(),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen } from "@testing-library/react"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"

/**
 * Dois defeitos MEDIDOS no `/curation/works` em 2026-08-14, os dois invisíveis a
 * `tsc` e à suíte inteira:
 *
 * 🔴 **A confiança sumiu do card** no commit `73a9510`, quando as ações viraram
 * pilha vertical: a `ConfidencePill` foi apagada e nada entrou no lugar. Ela
 * sobreviveu só DENTRO do chip de confiança baixa — ou seja, sumia justamente da
 * obra em "Aguardando revisão", que é quando o número decide se dá pra aceitar a
 * nota. E o seletor "Ordenar" continuou oferecendo "Confiança IA": dava pra
 * ordenar por um número que o card não mostrava.
 *
 * 🔴 **Não havia como REVISAR.** O modal só abria como resultado de uma avaliação
 * PAGA, então a única forma de ver a avaliação já gravada era pagar outra. O app
 * prometia o contrário: o toast de conclusão oferece "Revisar" apontando pra esta
 * página.
 *
 * Teste de RENDER de propósito. Um teste que lesse o objeto do work passaria
 * verde nos dois casos — o que quebrou foi a árvore desenhada.
 */

function work(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    title: "Revenge Begins With Marriage",
    publication_status: "Ongoing",
    publication_status_id: 2,
    personal_status: "Reading",
    personal_status_id: 3,
    matchedFilters: ["review-pending"],
    aiEvalStatus: "review_pending",
    evaluation: {
      confidence: 0.87,
      modelName: "claude-sonnet-5",
      promptVersion: "v22",
      evaluatedAt: "2026-08-08T12:00:00Z",
    },
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("card da fila de atributos", () => {
  it("mostra o % de confiança da avaliação", () => {
    render(<AiEvaluationPanel pendingWorks={[work()] as never} />)
    expect(screen.getByText("87%")).toBeTruthy()
  })

  it("oferece Revisar quando a obra está aguardando revisão", () => {
    render(<AiEvaluationPanel pendingWorks={[work()] as never} />)
    expect(screen.getByRole("button", { name: /Revisar/i })).toBeTruthy()
  })

  /**
   * 🔴 O caso que a 1ª versão do conserto erraria.
   *
   * `matchedFilters` responde "por que a obra apareceu" — a intersecção com os
   * filtros LIGADOS. Uma obra em `review_pending` que entre pela lista porque a
   * confiança é baixa chega com `["low-confidence"]`, e derivar o botão dali o
   * esconderia de quem está esperando revisão. O estado é fato do banco; o filtro
   * é uma pergunta que alguém fez.
   */
  it("oferece Revisar mesmo quando a obra apareceu por OUTRO filtro", () => {
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ matchedFilters: ["low-confidence"], evaluation: { confidence: 0.42, modelName: "claude-sonnet-5", promptVersion: "v22", evaluatedAt: "2026-08-08T12:00:00Z" } })] as never}
      />
    )
    expect(screen.getByRole("button", { name: /Revisar/i })).toBeTruthy()
  })

  it("NÃO oferece Revisar quando não há revisão pendente", () => {
    render(<AiEvaluationPanel pendingWorks={[work({ aiEvalStatus: "done", matchedFilters: ["outdated-model"] })] as never} />)
    expect(screen.queryByRole("button", { name: /^Revisar$/i })).toBeNull()
  })

  /**
   * O chip de confiança baixa perdeu o número porque ele passou a viver na linha
   * de procedência. Se voltar ao chip, a mesma confiança aparece duas vezes no
   * mesmo card — e qual das duas sobreviver ao próximo ajuste vira sorte.
   */
  it("não imprime a confiança duas vezes na obra de confiança baixa", () => {
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ matchedFilters: ["low-confidence"], evaluation: { confidence: 0.42, modelName: "claude-sonnet-5", promptVersion: "v22", evaluatedAt: "2026-08-08T12:00:00Z" } })] as never}
      />
    )
    expect(screen.getAllByText(/42%/)).toHaveLength(1)
  })
})
