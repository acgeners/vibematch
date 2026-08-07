import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

import { ScopedTaskStrip, useScopedGuard } from "@/components/tasks/scoped-task"

/**
 * A trava âmbar das ações request-scoped. O que estes testes protegem:
 *
 * 1. A trava só existe ENQUANTO roda — fora disso ela não pode atrapalhar nada.
 * 2. "Ficar" tem que de fato NÃO executar a saída. Um guard que deixa passar é
 *    pior que guard nenhum: dá confiança falsa.
 * 3. `guardNavigation` é opt-in. Ligado por engano numa ação dentro de modal, ele
 *    intercepta cliques que o scrim já bloqueia — código morto que parece proteção.
 */
function Harness({ running, guardNavigation = false }: { running: boolean; guardNavigation?: boolean }) {
  const { guard, guardDialog, elapsed } = useScopedGuard({
    running,
    title: "Fechar agora perde a busca",
    what: "Atualizar dados",
    confirmLabel: "Fechar mesmo assim",
    guardNavigation,
  })
  return (
    <div>
      {guardDialog}
      <ScopedTaskStrip running={running} elapsed={elapsed} label="Buscando…" note="Fique aqui." />
      <button onClick={() => guard(onProceed)}>fechar</button>
      <a href="/ranking">ir pro ranking</a>
    </div>
  )
}

const onProceed = vi.fn()

describe("faixa âmbar e trava de saída", () => {
  beforeEach(() => {
    onProceed.mockReset()
    push.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("a faixa não aparece quando nada está rodando", () => {
    render(<Harness running={false} />)
    expect(screen.queryByText("Buscando…")).toBeNull()
  })

  it("rodando, a faixa mostra o rótulo, o custo de sair e o cronômetro", () => {
    render(<Harness running />)
    expect(screen.getByText("Buscando…")).toBeTruthy()
    expect(screen.getByText("Fique aqui.")).toBeTruthy()
    expect(screen.getByText("0:00")).toBeTruthy()

    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText("0:03")).toBeTruthy()
  })

  it("parado, `guard` deixa passar na hora — sem confirmação nenhuma", () => {
    render(<Harness running={false} />)
    fireEvent.click(screen.getByText("fechar"))
    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Fechar agora perde a busca")).toBeNull()
  })

  it("rodando, `guard` SEGURA a saída e pede confirmação", () => {
    render(<Harness running />)
    fireEvent.click(screen.getByText("fechar"))
    expect(onProceed).not.toHaveBeenCalled()
    expect(screen.getByText("Fechar agora perde a busca")).toBeTruthy()
  })

  it("“Ficar” cancela — a saída NUNCA acontece", () => {
    render(<Harness running />)
    fireEvent.click(screen.getByText("fechar"))
    fireEvent.click(screen.getByText("Ficar"))
    expect(onProceed).not.toHaveBeenCalled()
  })

  it("“Fechar mesmo assim” executa a saída que estava presa", () => {
    render(<Harness running />)
    fireEvent.click(screen.getByText("fechar"))
    fireEvent.click(screen.getByText("Fechar mesmo assim"))
    expect(onProceed).toHaveBeenCalledTimes(1)
  })

  it("com `guardNavigation`, clicar num link interno é interceptado", () => {
    render(<Harness running guardNavigation />)
    fireEvent.click(screen.getByText("ir pro ranking"))
    expect(screen.getByText("Fechar agora perde a busca")).toBeTruthy()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText("Fechar mesmo assim"))
    expect(push).toHaveBeenCalledWith("/ranking")
  })

  it("SEM `guardNavigation` (o caso das modais), o clique no link passa direto", () => {
    render(<Harness running />)
    fireEvent.click(screen.getByText("ir pro ranking"))
    expect(screen.queryByText("Fechar agora perde a busca")).toBeNull()
  })

  it("o `beforeunload` só fica registrado enquanto roda", () => {
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")

    const { rerender, unmount } = render(<Harness running />)
    expect(add.mock.calls.some(([e]) => e === "beforeunload")).toBe(true)

    rerender(<Harness running={false} />)
    expect(remove.mock.calls.some(([e]) => e === "beforeunload")).toBe(true)

    unmount()
    add.mockRestore()
    remove.mockRestore()
  })
})
