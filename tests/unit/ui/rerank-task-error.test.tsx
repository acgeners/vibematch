import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => async () => true }))

const rerankSingleWorkAction = vi.fn()
vi.mock("@/server/actions/recommendations", () => ({
  rerankSingleWorkAction: (...args: unknown[]) => rerankSingleWorkAction(...args),
}))

import { dismissTask, readTasks } from "@/lib/tasks-store"
import { useRerankSingleWork } from "@/components/ranking/use-rerank-single-work"

function Probe() {
  const { run } = useRerankSingleWork("w1", "Kaiju No. 8")
  return <button onClick={() => void run()}>go</button>
}

/**
 * As server actions deste app devolvem `{ error }` em vez de LANÇAR. O `runTask`
 * só sabe distinguir sucesso de falha por rejeição da promise — então quem liga
 * uma action ao store tem que converter. Sem isso o indicador anuncia "pronto"
 * para uma falha: resultado plausível, errado, e sem erro nenhum no console.
 */
describe("ligação action → store: `{ error }` não pode virar sucesso", () => {
  beforeEach(() => {
    rerankSingleWorkAction.mockReset()
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
  })

  async function click() {
    const { getByText } = render(<Probe />)
    await act(async () => {
      getByText("go").click()
      await Promise.resolve()
    })
    // duas voltas de microtask: confirmCost (async) → run() → then do store
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  it("action que devolve { error } termina a tarefa em ERRO", async () => {
    rerankSingleWorkAction.mockResolvedValue({ error: "Limite diário atingido." })
    await click()

    const task = readTasks().find((t) => t.id === "rerank:w1")
    expect(task?.status).toBe("error")
    expect(task?.error).toBe("Limite diário atingido.")
  })

  it("action que devolve data sem erro termina em CONCLUÍDA", async () => {
    rerankSingleWorkAction.mockResolvedValue({ data: { alignmentScore: 82 } })
    await click()

    expect(readTasks().find((t) => t.id === "rerank:w1")?.status).toBe("done")
  })

  it("a tarefa é nomeada pela obra — o indicador é global e precisa dizer de qual", async () => {
    rerankSingleWorkAction.mockResolvedValue({ data: { alignmentScore: 82 } })
    await click()

    expect(readTasks().find((t) => t.id === "rerank:w1")?.label).toBe("Veredito IA: Kaiju No. 8")
  })
})
