import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
const skipAiEvaluation = vi.fn()
vi.mock("@/server/actions/ai", () => ({ skipAiEvaluation: (...a: unknown[]) => skipAiEvaluation(...a) }))
const markAiEvalWorksRead = vi.fn(async () => ({ ok: true, marked: 1 }))
vi.mock("@/server/actions/ai-eval-read", () => ({
  markAiEvalWorksRead: (...a: unknown[]) => markAiEvalWorksRead(...(a as [])),
  unmarkAiEvalWork: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/titles/rerank-ai-rk-button", () => ({ RerankAiRkButton: () => null }))
vi.mock("@/components/titles/use-batch-ai-actions", () => ({
  RERANK_TASK_ID: "rerank",
  useBatchAiActions: () => ({ rerank: vi.fn() }),
}))
vi.mock("@/components/tasks/use-app-tasks", () => ({ useAppTasks: () => [] }))

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { StaleRerankPanel } from "@/components/ranking/stale-rerank-panel"
import { useReadSplit } from "@/components/ai-evaluation/queue/read-split"

/**
 * Dois defeitos da fila de Veredito em /my-ai-scores (2026-11-16):
 *
 * 🔴 **A lista não batia com o número da aba.** A aba contava só as obras NÃO lidas e a
 * lista desenhava todas, com as lidas apagadas e misturadas por título: "12" na aba sobre
 * 40 cards. Hoje a lista aberta é a das novas, e as lidas ficam numa seção recolhida.
 *
 * 🔴 **"Pular" decidia sobre o CATÁLOGO.** Ele gravava `works.ai_eval_status = 'skipped'`
 * — o status da avaliação de atributos, de todo mundo. O Veredito é per-usuário: pular
 * tem de valer só para quem pulou.
 *
 * Teste de RENDER: o que regride é a árvore desenhada e a action chamada pelo botão.
 */

function work(id: string, title: string) {
  return {
    id,
    title,
    coverUrls: [],
    publicationStatusId: 2,
    personalStatusId: 10,
    synopsisQuality: null,
    expectedScore: 7.5,
    alignmentScore: 60,
    alignmentStale: true,
    alignmentAt: "2026-11-01T00:00:00Z",
    tagCount: 10,
    reviewCount: 5,
    isAdult: false,
    isMixed: false,
    userScore: null,
  }
}

const ID = {
  a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b",
  c: "00000000-0000-4000-8000-00000000000c",
}
const works = [work(ID.a, "Alpha"), work(ID.b, "Beta"), work(ID.c, "Gamma")]

describe("fila de Veredito: lidas recolhidas e Pular pessoal", () => {
  beforeEach(() => {
    skipAiEvaluation.mockClear()
    markAiEvalWorksRead.mockClear()
  })

  it("a lista aberta são só as novas; as lidas ficam recolhidas com a contagem", () => {
    render(<StaleRerankPanel works={works} readIds={[ID.b]} />)
    expect(screen.getByText("Alpha")).toBeTruthy()
    expect(screen.getByText("Gamma")).toBeTruthy()
    expect(screen.queryByText("Beta")).toBeNull()

    const toggle = screen.getByRole("button", { name: /Lidas ou puladas \(1\)/ })
    fireEvent.click(toggle)
    expect(screen.getByText("Beta")).toBeTruthy()
  })

  it("Pular marca como lida só para quem pulou — nunca grava o status do catálogo", async () => {
    render(<StaleRerankPanel works={works} readIds={[]} />)
    const pular = screen.getAllByRole("button", { name: /Pular/ })
    expect(pular).toHaveLength(3)
    await act(async () => {
      fireEvent.click(pular[0])
    })
    expect(skipAiEvaluation).not.toHaveBeenCalled()
    expect(markAiEvalWorksRead).toHaveBeenCalledWith([ID.a], "veredito")
  })
})

describe("useReadSplit: a seleção só alcança o que está na tela", () => {
  it("visibleIds exclui as lidas enquanto a seção está recolhida", () => {
    const isRead = (id: string) => id === ID.b
    const { result } = renderHook(() => useReadSplit(works, isRead))
    expect(result.current.visibleIds).toEqual([ID.a, ID.c])
    expect(result.current.read.map((w) => w.id)).toEqual([ID.b])
    act(() => result.current.toggleShowRead())
    expect(result.current.visibleIds).toEqual([ID.a, ID.c, ID.b])
  })
})
