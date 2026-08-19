import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("@/server/actions/ai", () => ({
  triggerAiEvaluation: vi.fn(),
  skipAiEvaluation: vi.fn(),
  prewarmEvaluationContext: vi.fn(),
  loadAiEvaluationForReview: vi.fn(),
}))
// Default: o caminho FELIZ. O caso do bloqueio nem chega a chamar a action — é esse o
// ponto do atalho —, então devolver "blocked" aqui esconderia se ele foi chamado ou não.
const prepareAndEvaluate = vi.fn(async () => ({
  kind: "evaluated",
  prep: { reviews: 12, digest: "fresh", tagsAdded: 3 },
  result: { data: { evaluation: { id: "e1" }, currentScores: {}, currentEvaluation: null } },
}))
vi.mock("@/server/actions/prepare-and-evaluate", () => ({
  prepareAndEvaluate: (...a: unknown[]) => prepareAndEvaluate(...(a as [])),
}))
vi.mock("@/server/actions/comix-resolver", () => ({ getComixHealthStatus: vi.fn(async () => null) }))
vi.mock("@/server/actions/ai-eval-read", () => ({ markAiEvalRead: vi.fn(), unmarkAiEvalRead: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
const confirmCost = vi.fn(async () => true)
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => confirmCost }))

import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { classifyEvalPrep } from "@/lib/ai-evaluation/eval-readiness"

/**
 * O que o card PROMETE, na árvore desenhada.
 *
 * Teste de RENDER de propósito: `classifyEvalPrep` pode estar perfeito e o card
 * continuar dizendo "Avaliar" numa obra que precisa de preparo — foi exatamente esse
 * desencontro (a régua num lugar, o rótulo noutro) que obrigava a abrir obra por obra.
 * Um teste que lesse o objeto `prep` passaria verde com o botão errado na tela.
 *
 * ⚠️ O `prep` de cada caso vem de `classifyEvalPrep`, nunca montado à mão: um objeto
 * literal aqui viraria uma 2ª definição de "precisa preparar" e continuaria verde no dia
 * em que a régua mudasse.
 */

const prep = (over: Parameters<typeof classifyEvalPrep>[0] extends infer T ? Partial<T> : never = {}) =>
  classifyEvalPrep({
    sourceStates: { comix: "linked", mangago: "linked" },
    tagsInferredAt: "2026-08-18T00:00:00.000Z",
    reviewDigestAt: "2026-08-10T00:00:00.000Z",
    reviewSummaryAt: null,
    ...over,
  })

function work(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    title: "Revenge Begins With Marriage",
    publication_status: "Ongoing",
    publication_status_id: 2,
    personal_status: "Reading",
    personal_status_id: 3,
    matchedFilters: ["outdated-reviews"],
    aiEvalStatus: "done",
    evaluation: {
      confidence: 0.87,
      modelName: "claude-sonnet-5",
      promptVersion: "v26",
      evaluatedAt: "2026-08-10T12:00:00.000Z",
    },
    ...over,
  }
}

describe("o rótulo do botão segue a prontidão", () => {
  it("tags anteriores ao contexto de reviews ⇒ 'Preparar e avaliar'", () => {
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ prep: prep({ tagsInferredAt: "2026-08-01T00:00:00.000Z" }) })] as never}
      />,
    )
    expect(screen.getByRole("button", { name: /^Preparar e avaliar$/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Reavaliar$/i })).toBeNull()
  })

  it("obra pronta ⇒ 'Reavaliar', sem prometer preparo que não vai acontecer", () => {
    render(<AiEvaluationPanel pendingWorks={[work({ prep: prep() })] as never} />)
    expect(screen.getByRole("button", { name: /Reavaliar/i })).toBeTruthy()
    // O botão do CARD. "Preparar e avaliar em fila" é da toolbar e continua existindo.
    expect(screen.queryByRole("button", { name: /^Preparar e avaliar$/i })).toBeNull()
  })

  it("sem `prep` (aba que não hidrata) degrada pro fluxo antigo, sem quebrar", () => {
    render(<AiEvaluationPanel pendingWorks={[work()] as never} />)
    expect(screen.getByRole("button", { name: /Reavaliar/i })).toBeTruthy()
  })
})

describe("o chip de estado", () => {
  it("🔴 fonte principal faltando aparece, e VENCE 'Reviews novas'", () => {
    // É o único chip que diz que a ação NÃO roda; os outros dizem por que a obra entrou
    // na fila. Enterrá-lo atrás de "Reviews novas" deixaria o botão travado sem motivo
    // visível na tela.
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ prep: prep({ sourceStates: { comix: "linked" } }) })] as never}
      />,
    )
    expect(screen.getByText(/Sem Mangago/i)).toBeTruthy()
    expect(screen.queryByText(/^Reviews novas$/i)).toBeNull()
  })

  it("as duas fontes faltando saem numa frase só", () => {
    render(<AiEvaluationPanel pendingWorks={[work({ prep: prep({ sourceStates: {} }) })] as never} />)
    expect(screen.getByText(/Sem Comix e Mangago/i)).toBeTruthy()
  })

  it("🔴 tags desatualizadas NÃO viram chip — 76% da fila acenderia", () => {
    // Alarme que sempre toca não é lido (a mesma régua que mantém Digests e Fontes sem
    // ponto). O sinal existe: vive no RÓTULO do botão, onde vira decisão.
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ prep: prep({ tagsInferredAt: null }) })] as never}
      />,
    )
    expect(screen.queryByText(/tags/i)).toBeNull()
    expect(screen.getByText(/^Reviews novas$/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Preparar e avaliar$/i })).toBeTruthy()
  })
})

describe("obra travada por fonte", () => {
  beforeEach(() => vi.clearAllMocks())

  it("🔴 NÃO pede autorização de gasto — o clique vai direto pro aviso", async () => {
    // O fluxo antigo era: popup pedindo ~9,4¢ → você confirma → o servidor barra e não
    // gasta nada. Autorizar um gasto que não vai acontecer ensina a clicar "ok" sem ler.
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ prep: prep({ sourceStates: { comix: "linked" } }) })] as never}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Preparar e avaliar$/i }))
    await waitFor(() => expect(screen.getByText(/sem fonte principal/i)).toBeTruthy())
    expect(confirmCost).not.toHaveBeenCalled()
    expect(prepareAndEvaluate).not.toHaveBeenCalled()
  })

  it("obra SEM bloqueio segue pedindo autorização antes de gastar", async () => {
    // Contraprova: o atalho não pode virar um jeito de pular o popup no caso normal.
    render(
      <AiEvaluationPanel
        pendingWorks={[work({ prep: prep({ tagsInferredAt: null }) })] as never}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Preparar e avaliar$/i }))
    await waitFor(() => expect(confirmCost).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(prepareAndEvaluate).toHaveBeenCalledTimes(1))
  })
})
