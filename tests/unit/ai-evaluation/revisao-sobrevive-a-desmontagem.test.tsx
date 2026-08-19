import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))
vi.mock("@/components/layout/admin-context", () => ({ useIsAdmin: () => true }))
vi.mock("@/components/titles/external-manual-reviews-section", () => ({
  ExternalManualReviewsSection: () => null,
}))

const triggerAiEvaluation = vi.fn()
vi.mock("@/server/actions/ai", () => ({
  triggerAiEvaluation: (...a: unknown[]) => triggerAiEvaluation(...a),
  submitAiReview: vi.fn(),
}))
vi.mock("@/server/actions/manual-reviews", () => ({
  getEvaluationInputs: vi.fn(async () => ({ synopsis: "" })),
  updatePrimarySynopsis: vi.fn(async () => ({})),
}))

import { act, render, cleanup, screen } from "@testing-library/react"
import { AiEvaluationButton } from "@/components/titles/ai-evaluation-button"
import { clearPendingAiReview, readPendingAiReview } from "@/lib/ai-evaluation/pending-review-store"
import { dismissTask, readTasks } from "@/lib/tasks-store"

/**
 * 🔴 O popup de revisão "às vezes não abria", e o mecanismo é estrutural, não
 * intermitente: o `AiEvaluationButton` mora dentro de `<TabsContent value="ai">` na
 * página da obra, e o Radix DESMONTA a aba inativa (`<Presence present={forceMount
 * || isSelected}>`, e não há `forceMount`). Com o resultado em `useState`, trocar
 * de aba — ou navegar — durante os ~17,5s da avaliação matava o `setEvaluation` do
 * `onDone`: no-op silencioso, avaliação gravada em `review_pending`, popup nunca
 * aberto. A tarefa azul ainda anunciava "pronto".
 *
 * Teste de RENDER, e o caso que importa é o do MEIO: um teste que só montasse e
 * clicasse passa verde com o bug inteiro no lugar.
 */

const RESULT = {
  data: {
    evaluation: {
      id: "eval-1",
      work_id: "w1",
      status: "completed",
      model_name: "claude-sonnet-5",
      prompt_version: "v26",
      confidence: 0.82,
      summary: "Comédia romântica isekai com protagonista de agência forte.",
      created_at: "2026-08-18T20:00:00.000Z",
      raw_response: {},
      ai_evaluation_scores: [
        { criterion_slug: "romance", suggested_score: 8, justification: "Faixa 7-8: central." },
      ],
    },
    currentScores: { romance: 7 },
    currentEvaluation: null,
    reviewsUsed: 12,
  },
}

function renderButton() {
  return render(
    <AiEvaluationButton workId="w1" workTitle="The Baby Fairy Is a Villainess" hasCriteriaScores />,
  )
}

/** Deixa as microtasks do confirmCost → run() → then do store assentarem. */
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve() })
}

describe("resultado da avaliação IA sobrevive à desmontagem do componente", () => {
  beforeEach(() => {
    triggerAiEvaluation.mockReset()
    clearPendingAiReview("w1")
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    clearPendingAiReview("w1")
    for (const t of readTasks()) dismissTask(t.id)
  })

  it("abre a revisão quando a aba continua montada (caso feliz)", async () => {
    triggerAiEvaluation.mockResolvedValue(RESULT)
    renderButton()
    await act(async () => { screen.getByText("Reavaliar com IA").click() })
    await settle()

    expect(screen.getByText("Revisar avaliação IA")).toBeTruthy()
  })

  it("🔴 desmontar DURANTE a avaliação (troca de aba) não perde o resultado: remontar abre a revisão", async () => {
    let resolveEval: (v: unknown) => void = () => {}
    triggerAiEvaluation.mockReturnValue(new Promise((r) => { resolveEval = r }))

    renderButton()
    await act(async () => { screen.getByText("Reavaliar com IA").click() })
    await settle()

    // O Radix desmonta a aba inativa — é exatamente isto que acontecia ao ir olhar
    // outra aba da obra enquanto a IA rodava.
    cleanup()
    expect(screen.queryByText("Revisar avaliação IA")).toBeNull()

    // A avaliação termina com o componente FORA da árvore.
    await act(async () => { resolveEval(RESULT) })
    await settle()
    expect(readPendingAiReview("w1")).not.toBeNull()

    // Voltar para a aba remonta o componente: a revisão tem que estar lá.
    renderButton()
    await settle()
    expect(screen.getByText("Revisar avaliação IA")).toBeTruthy()
    expect(screen.getByText(/Comédia romântica isekai/)).toBeTruthy()
  })

  it("descartar limpa o pendente — senão a revisão reabriria em toda volta à aba", async () => {
    triggerAiEvaluation.mockResolvedValue(RESULT)
    renderButton()
    await act(async () => { screen.getByText("Reavaliar com IA").click() })
    await settle()

    expect(readPendingAiReview("w1")).not.toBeNull()
    await act(async () => { clearPendingAiReview("w1") })
    expect(screen.queryByText("Revisar avaliação IA")).toBeNull()
  })

  it("o pendente é por OBRA — outra obra não herda a revisão desta", async () => {
    triggerAiEvaluation.mockResolvedValue(RESULT)
    renderButton()
    await act(async () => { screen.getByText("Reavaliar com IA").click() })
    await settle()
    cleanup()

    render(<AiEvaluationButton workId="w2" workTitle="Outra obra" hasCriteriaScores />)
    await settle()
    expect(screen.queryByText("Revisar avaliação IA")).toBeNull()
  })
})
