import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, screen, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
// O store dispara toast + refresh do chrome ao concluir; nenhum dos dois é o
// alvo aqui, e ambos puxam browser APIs que o jsdom não tem.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))

import { runTask, dismissTask, readTasks } from "@/lib/tasks-store"
import { TasksChip, TasksProgressBar } from "@/components/tasks/top-nav-tasks"

/**
 * O indicador de tarefas na barra superior. Estes testes existem porque a
 * versão anterior desta feature morreu EM SILÊNCIO: `SidebarTasks` ficou órfão
 * quando a sidebar saiu, e no desktop a tarefa entrava no store sem ninguém
 * desenhar. Nada quebrou — nem build, nem runtime, nem teste. Só o feedback
 * sumiu. Daí um teste que afirma "com tarefa no store, o chrome MOSTRA algo".
 */
describe("indicador de tarefas na barra superior", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const t of readTasks()) dismissTask(t.id)
  })

  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
    vi.useRealTimers()
  })

  function startTask(id = "ai-eval:1", label = "Avaliando: Kaiju No. 8") {
    let settle: (v: string) => void = () => {}
    act(() => {
      runTask({ id, kind: "ai-eval", label, run: () => new Promise<string>((r) => (settle = r)) })
    })
    return () => act(() => { settle("ok") })
  }

  it("sem tarefa, não desenha nada (chip e faixa ausentes)", () => {
    render(<><TasksProgressBar /><TasksChip /></>)
    expect(screen.queryByRole("button", { name: /tarefas em segundo plano/i })).toBeNull()
  })

  it("com tarefa rodando, o chip aparece com o contador", () => {
    startTask()
    render(<><TasksProgressBar /><TasksChip /></>)
    const chip = screen.getByRole("button", { name: /tarefas em segundo plano/i })
    expect(chip.getAttribute("aria-label")).toContain("1 em andamento")
  })

  it("a prévia abre sozinha ao começar e recolhe depois", () => {
    startTask()
    render(<><TasksProgressBar /><TasksChip /></>)
    const chip = screen.getByRole("button", { name: /tarefas em segundo plano/i })

    // Aberta no instante do disparo — é quando o olho ainda está no botão clicado.
    expect(chip.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByTitle("Avaliando: Kaiju No. 8")).toBeTruthy()

    act(() => { vi.advanceTimersByTime(5000) })
    expect(chip.getAttribute("aria-expanded")).toBe("false")
  })

  it("recolhida a prévia, o chip continua lá enquanto a tarefa roda", () => {
    startTask()
    render(<><TasksProgressBar /><TasksChip /></>)
    act(() => { vi.advanceTimersByTime(5000) })

    const chip = screen.getByRole("button", { name: /tarefas em segundo plano/i })
    expect(chip.getAttribute("aria-expanded")).toBe("false")
    expect(chip.getAttribute("aria-label")).toContain("1 em andamento")
  })

  it("uma segunda tarefa reabre a prévia e o contador vira 2", () => {
    startTask("ai-eval:1")
    render(<><TasksProgressBar /><TasksChip /></>)
    act(() => { vi.advanceTimersByTime(5000) })

    startTask("recommend", "Recomendando com IA")
    const chip = screen.getByRole("button", { name: /tarefas em segundo plano/i })
    expect(chip.getAttribute("aria-label")).toContain("2 em andamento")
    expect(chip.getAttribute("aria-expanded")).toBe("true")
  })

  it("ao concluir, o chip muda de estado — e NÃO reabre a prévia (quem avisa é o toast)", async () => {
    const finish = startTask()
    render(<><TasksProgressBar /><TasksChip /></>)
    act(() => { vi.advanceTimersByTime(5000) })

    finish()
    await act(async () => { await Promise.resolve() })

    const chip = screen.getByRole("button", { name: /tarefas em segundo plano/i })
    expect(chip.getAttribute("aria-label")).toContain("Pronto")
    expect(chip.getAttribute("aria-expanded")).toBe("false")
  })
})
