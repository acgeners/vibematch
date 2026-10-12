import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"

/**
 * A linha discreta da aba "Meu Status" numa obra mixed: "Sua avaliação é da versão R18 · Alterar".
 * RENDER: o que regride é a tela afirmar a versão errada ou o "Alterar" chamar a action errada.
 */
const setEvaluationEdition = vi.fn()
const refresh = vi.fn()
vi.mock("@/server/actions/read-edition", () => ({ setEvaluationEdition: (...a: unknown[]) => setEvaluationEdition(...a) }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => refresh }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { EvaluationEditionLine, evaluationEditionText } from "@/components/titles/evaluation-edition-line"

beforeEach(() => {
  setEvaluationEdition.mockReset()
  refresh.mockReset()
})
afterEach(cleanup)

describe("o texto diz a versão da AVALIAÇÃO, não a da tela", () => {
  it("sem avaliação: em que versão ela vai ser registrada (a ativa)", () => {
    expect(evaluationEditionText({ hasEvaluation: false, evaluationEdition: null, activeEdition: "r18" })).toBe(
      "Sua avaliação será registrada na versão R18, a que você está vendo.",
    )
  })
  it("com avaliação na mesma versão da tela", () => {
    expect(evaluationEditionText({ hasEvaluation: true, evaluationEdition: "r18", activeEdition: "r18" })).toBe("Sua avaliação é da versão R18")
  })
  it("com avaliação de OUTRA versão: diz as duas", () => {
    expect(evaluationEditionText({ hasEvaluation: true, evaluationEdition: "r18", activeEdition: "normal" })).toBe(
      "Sua avaliação é da versão R18 (você está vendo a versão normal)",
    )
  })
  it("avaliação histórica sem versão", () => {
    expect(evaluationEditionText({ hasEvaluation: true, evaluationEdition: null, activeEdition: "normal" })).toBe("Versão da sua avaliação não registrada")
  })
})

describe("Alterar", () => {
  it("abre as duas opções e grava a escolhida como troca explícita", async () => {
    setEvaluationEdition.mockResolvedValue({ ok: true, changed: true })
    render(<EvaluationEditionLine workId="w1" hasEvaluation evaluationEdition="r18" activeEdition="r18" />)
    expect(screen.queryByRole("button", { name: "Versão normal" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }))
    expect((screen.getByRole("button", { name: "Versão R18" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Versão normal" }))
    await waitFor(() => expect(setEvaluationEdition).toHaveBeenCalledWith("w1", "normal"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
  it("histórica sem versão oferece as duas direto, sem 'Alterar'", () => {
    render(<EvaluationEditionLine workId="w1" hasEvaluation evaluationEdition={null} activeEdition="normal" />)
    expect(screen.queryByRole("button", { name: "Alterar" })).toBeNull()
    expect(screen.getByRole("button", { name: "Versão normal" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Versão R18" })).toBeTruthy()
  })
  it("sem avaliação não há o que alterar (só informa)", () => {
    render(<EvaluationEditionLine workId="w1" hasEvaluation={false} evaluationEdition={null} activeEdition="r18" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("falha da action: não recarrega e mantém as opções abertas", async () => {
    setEvaluationEdition.mockResolvedValue({ ok: false, error: "x" })
    render(<EvaluationEditionLine workId="w1" hasEvaluation evaluationEdition="r18" activeEdition="r18" />)
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }))
    fireEvent.click(screen.getByRole("button", { name: "Versão normal" }))
    await waitFor(() => expect(setEvaluationEdition).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Versão normal" })).toBeTruthy()
  })
})
