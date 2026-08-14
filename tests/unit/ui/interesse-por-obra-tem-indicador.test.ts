import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const predictAction = vi.fn()
vi.mock("@/server/actions/synopsis-quality", () => ({
  predictSynopsisQualityForWorkAction: (...args: unknown[]) => predictAction(...args),
}))

const runTask = vi.fn()
vi.mock("@/lib/tasks-store", () => ({ runTask: (spec: unknown) => runTask(spec) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { predictInterestWithToast } from "@/components/titles/predict-interest-toast"

/**
 * A previsão de Interesse POR OBRA precisa de indicador — mas só DEPOIS do modal.
 *
 * 🔴 O erro que este arquivo existe pra impedir tem DOIS lados opostos, e corrigir
 * um sem o outro é o que manteve esta pendência aberta:
 *
 * - **sem tarefa nenhuma** (o estado até 2026-08-14): confirmar "Atualizar perfil e
 *   prever" fechava o modal e deixava a tela ~40s idêntica ao estado anterior;
 * - **tarefa em volta da chamada inteira**: o indicador anunciaria "rodando" durante
 *   o tempo em que o modal está aberto esperando um clique — afirmando trabalho que
 *   não começou, e que pode nem começar se a pessoa cancelar.
 */
describe("indicador da previsão de Interesse por obra", () => {
  beforeEach(() => {
    predictAction.mockReset()
    runTask.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it("previsão direta não abre tarefa — não houve confirmação nem espera", async () => {
    predictAction.mockResolvedValue({ status: "succeeded", predictedQuality: 4, partial: false })
    await predictInterestWithToast("w1", () => {})
    expect(runTask).not.toHaveBeenCalled()
  })

  it("enquanto o modal decide, nada é anunciado como rodando", async () => {
    predictAction.mockResolvedValue({
      status: "blocked_cost_confirmation",
      reason: "profile_cascade",
      likelyUsd: 0.4,
      upperBoundUsd: 0.6,
      message: "Perfil ~30 dias.",
    })
    // O confirmador nunca resolve: é o modal aberto, esperando.
    const pendente = predictInterestWithToast("w1", () => {}, {}, () => new Promise<boolean>(() => {}))
    await Promise.resolve()
    expect(runTask).not.toHaveBeenCalled()
    void pendente
  })

  it("confirmar a cascata abre tarefa DURÁVEL que nomeia as duas etapas", async () => {
    predictAction.mockResolvedValue({
      status: "blocked_cost_confirmation",
      reason: "profile_cascade",
      likelyUsd: 0.4,
      upperBoundUsd: 0.6,
      message: "Perfil ~30 dias.",
    })
    await predictInterestWithToast("w1", () => {}, {}, async () => true)

    expect(runTask).toHaveBeenCalledTimes(1)
    const spec = runTask.mock.calls[0][0]
    expect(spec.label).toContain("perfil")
    // Por OBRA: duas obras em paralelo são duas tarefas; o mesmo botão clicado duas
    // vezes é deduplicado pelo store em vez de cobrar duas chamadas pagas.
    expect(spec.id).toBe("interest:w1")
    // O desfecho tipado já vira toast no `switch`; o genérico diria "pronto" até
    // quando a previsão volta `failed`.
    expect(spec.successToast()).toBeNull()
  })

  it("o caminho barato (perfil atual) também tem indicador", async () => {
    predictAction.mockResolvedValue({
      status: "blocked_cost_confirmation",
      reason: "profile_cascade",
      likelyUsd: 0.4,
      upperBoundUsd: 0.6,
      message: "Perfil ~30 dias.",
    })
    let secondary: { onSelect: () => void } | undefined
    await predictInterestWithToast("w9", () => {}, {}, async (spec) => {
      secondary = (spec as { secondaryAction?: { onSelect: () => void } }).secondaryAction
      return false // a pessoa escolheu o botão secundário, não o principal
    })
    expect(runTask).not.toHaveBeenCalled()

    secondary?.onSelect()
    expect(runTask).toHaveBeenCalledTimes(1)
    expect(runTask.mock.calls[0][0].id).toBe("interest:w9")
  })

  it("bloqueio por teto não vira tarefa — é notificação, não trabalho", async () => {
    predictAction.mockResolvedValue({
      status: "blocked_cost_confirmation",
      reason: "over_cap",
      likelyUsd: 0.4,
      upperBoundUsd: 0.6,
      message: "Acima do teto.",
    })
    await predictInterestWithToast("w1", () => {}, {}, async () => true)
    expect(runTask).not.toHaveBeenCalled()
  })
})
