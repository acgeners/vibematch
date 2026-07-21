import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock("next/image", () => ({ default: () => null }))

const submitAiReview = vi.fn()
vi.mock("@/server/actions/ai", () => ({
  submitAiReview: (...a: unknown[]) => submitAiReview(...a),
}))

import { render, screen, fireEvent } from "@testing-library/react"
import { AiEvaluationReviewForm } from "@/components/ai-evaluation/ai-evaluation-review-form"

const CURRENT = { romance: 8.0, drama: 7.0, art: 8.5 }

function evaluation(confidence: number | null = 0.82) {
  return {
    id: "eval-1",
    confidence,
    summary: "Resumo da IA.",
    raw_response: {},
    model_name: "claude-sonnet-4-6",
    ai_evaluation_scores: [
      { criterion_slug: "romance", suggested_score: 7.5, justification: "j1" },
      { criterion_slug: "drama", suggested_score: 5.0, justification: "j2" },
      { criterion_slug: "art", suggested_score: 8.5, justification: "j3" },
    ],
  } as never
}

function renderForm(conf: number | null = 0.82) {
  const onSaved = vi.fn()
  render(
    <AiEvaluationReviewForm
      evaluation={evaluation(conf)}
      workId="w1"
      workTitle="Obra"
      currentScores={CURRENT}
      onSaved={onSaved}
    />
  )
  return { onSaved }
}

const clickApply = (label: "atual" | "sugerida") =>
  fireEvent.click(
    screen.getByRole("button", { name: `Aplicar a nota ${label} a todos os critérios` })
  )
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }))

describe("Revisão da avaliação IA — aplicar a todos", () => {
  beforeEach(() => {
    submitAiReview.mockReset()
    submitAiReview.mockResolvedValue({ error: null })
  })

  it("'Atual' posiciona TODOS os critérios sem salvar", () => {
    renderForm()
    clickApply("atual")
    expect(submitAiReview).not.toHaveBeenCalled()

    save()
    expect(submitAiReview).toHaveBeenCalledTimes(1)
    const sent = submitAiReview.mock.calls[0][0].scores
    expect(sent).toEqual(
      expect.arrayContaining([
        { criterionSlug: "romance", acceptedScore: 8.0, wasEdited: true },
        { criterionSlug: "drama", acceptedScore: 7.0, wasEdited: true },
        // Igual nos dois lados: manter a atual não conta como edição.
        { criterionSlug: "art", acceptedScore: 8.5, wasEdited: false },
      ])
    )
  })

  it("aplicar em bloco e depois destoar UM critério salva a mistura", () => {
    renderForm()
    clickApply("sugerida")
    // Dentro do card de Drama, escolhe a nota atual (7.0) em vez da sugerida (5.0).
    fireEvent.click(screen.getByRole("button", { name: /Atual\s*7\.0/ }))
    save()

    const sent = submitAiReview.mock.calls[0][0].scores
    expect(sent).toEqual(
      expect.arrayContaining([
        { criterionSlug: "romance", acceptedScore: 7.5, wasEdited: false },
        { criterionSlug: "drama", acceptedScore: 7.0, wasEdited: true },
      ])
    )
  })

  it("conta quantos critérios diferem e quantos a gravação muda", () => {
    renderForm()
    // romance 8→7.5 e drama 7→5 diferem; art 8.5 é igual nos dois lados.
    expect(screen.getByText(/2 de 3/)).toBeTruthy()
    // Variação média é ABSOLUTA: (0,5 + 2) / 2 = 1,3.
    const resumo = screen.getByText(/critérios têm/).textContent ?? ""
    expect(resumo).toMatch(/2\s*mudam/)
    expect(resumo).toMatch(/variação média\s*1\.3/)

    clickApply("atual")
    expect(screen.getByText(/salvar não muda nada/i)).toBeTruthy()
  })

  it("deltas que se cancelam NÃO viram 'quase não muda nada'", () => {
    // +2 e −2 dariam média assinada 0.0 — a linha diria que salvar quase não
    // muda nada enquanto duas notas se mexem 2 pontos cada. Por isso a média é
    // do |delta|.
    render(
      <AiEvaluationReviewForm
        evaluation={{
          id: "e2",
          confidence: 0.8,
          summary: null,
          raw_response: {},
          model_name: "claude-sonnet-4-6",
          ai_evaluation_scores: [
            { criterion_slug: "romance", suggested_score: 9.0, justification: "j" },
            { criterion_slug: "drama", suggested_score: 5.0, justification: "j" },
          ],
        } as never}
        workId="w1"
        workTitle="Obra"
        currentScores={{ romance: 7.0, drama: 7.0 }}
        onSaved={vi.fn()}
      />
    )
    const resumo = screen.getByText(/critérios têm/).textContent ?? ""
    expect(resumo).toMatch(/variação média\s*2\.0/)
    expect(resumo).not.toMatch(/0\.0/)
  })

  it("PRIMEIRA avaliação (sem nota atual) ainda mostra a confiança", () => {
    // A confiança mora dentro dos botões Atual/Sugerido, que não existem sem
    // nota atual — sem um ramo próprio ela sumia da tela inteira.
    render(
      <AiEvaluationReviewForm
        evaluation={evaluation(0.82)}
        workId="w1"
        workTitle="Obra"
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByTitle(/Confiança da IA nesta avaliação/).textContent).toMatch(/82%/)
    // Sem nota atual não há conjunto pra escolher — o aplicar-a-todos não aparece.
    expect(
      screen.queryByRole("button", { name: /Aplicar a nota atual/ })
    ).toBeNull()
  })

  it("confiança baixa pede confirmação no Salvar, não antes", () => {
    renderForm(0.4)
    clickApply("sugerida")
    save()

    // Não gravou ainda: abriu o diálogo de fricção.
    expect(submitAiReview).not.toHaveBeenCalled()
    expect(screen.getByText(/Confiança baixa/i)).toBeTruthy()
  })

  it("mantendo tudo atual, confiança baixa NÃO atrapalha", () => {
    renderForm(0.4)
    clickApply("atual")
    save()
    // Nenhuma nota nova da IA entra — não há por que perguntar.
    expect(submitAiReview).toHaveBeenCalledTimes(1)
  })
})
