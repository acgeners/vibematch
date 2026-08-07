import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, screen, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))

import { runTask, setTaskProgress, dismissTask, readTasks } from "@/lib/tasks-store"
import { TaskCard } from "@/components/tasks/task-card"

/**
 * Andamento de tarefa em LOTE. Existe porque o contador ("3/12") das ações mais
 * longas do app vivia em estado de componente: quem navegava perdia justamente
 * a informação que importa numa espera de minutos.
 */
describe("andamento de tarefa em lote", () => {
  beforeEach(() => {
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
  })

  function startBatch(id = "rerank-batch") {
    let settle: (v: string) => void = () => {}
    act(() => {
      runTask({
        id,
        kind: "rerank-batch",
        label: "Veredito IA: 12 obras",
        run: () => new Promise<string>((r) => (settle = r)),
      })
    })
    return () => act(() => settle("ok"))
  }

  it("mostra o contador e a barra determinada quando há andamento", () => {
    startBatch()
    render(<TaskCard />)
    expect(screen.queryByText("3/12")).toBeNull()

    act(() => setTaskProgress("rerank-batch", 3, 12))
    expect(screen.getByText("3/12")).toBeTruthy()

    const bar = document.querySelector<HTMLElement>('[style*="width"]')
    expect(bar?.style.width).toBe("25%")
  })

  it("sem andamento, a barra segue INDETERMINADA (nem toda tarefa é lote)", () => {
    startBatch("ai-eval:1")
    render(<TaskCard />)
    expect(document.querySelector(".task-indeterminate-bar")).toBeTruthy()
  })

  it("não ressuscita tarefa já concluída nem inventa uma que não existe", async () => {
    const finish = startBatch()
    finish()
    await act(async () => { await Promise.resolve() })

    act(() => setTaskProgress("rerank-batch", 5, 12))
    // O laço do caller pode terminar DEPOIS de o usuário dispensar; um `setTask`
    // solto aqui traria a tarefa de volta do nada.
    expect(readTasks().find((t) => t.id === "rerank-batch")?.progress).toBeUndefined()

    expect(() => setTaskProgress("nao-existe", 1, 2)).not.toThrow()
    expect(readTasks().some((t) => t.id === "nao-existe")).toBe(false)
  })

  it("total 0 não vira NaN, e done acima do total não passa de 100%", () => {
    startBatch()
    render(<TaskCard />)

    act(() => setTaskProgress("rerank-batch", 0, 0))
    expect(document.querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe("0%")

    act(() => setTaskProgress("rerank-batch", 99, 12))
    expect(document.querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe("100%")
  })
})
