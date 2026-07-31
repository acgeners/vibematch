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

    // Tudo mantido na atual ⇒ a gravação não mudaria nada e o Salvar DESARMA
    // (gating de sem-mudança). Clicar não grava.
    save()
    expect(submitAiReview).not.toHaveBeenCalled()
    expect(screen.getByText(/salvar não muda nada/i)).toBeTruthy()

    // Destoar UM critério pro sugerido rearma o Salvar e grava a mistura que o
    // "Atual" em bloco posicionou nos demais.
    fireEvent.click(screen.getByRole("button", { name: /Sugerido\s*5\.0/ }))
    save()
    expect(submitAiReview).toHaveBeenCalledTimes(1)
    const sent = submitAiReview.mock.calls[0][0].scores
    expect(sent).toEqual(
      expect.arrayContaining([
        { criterionSlug: "romance", acceptedScore: 8.0, wasEdited: true },
        { criterionSlug: "drama", acceptedScore: 5.0, wasEdited: false },
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
    expect(screen.getByTitle(/Confiança declarada pela IA/).textContent).toMatch(/82%/)
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
    // Nenhuma nota nova da IA entra — não há por que perguntar. Com o gating de
    // sem-mudança o Salvar nem arma: nada grava e o diálogo de fricção não abre.
    expect(screen.queryByText(/Confiança baixa/i)).toBeNull()
    expect(submitAiReview).not.toHaveBeenCalled()
  })
})

describe("Revisão da avaliação IA — réguas de confiança", () => {
  beforeEach(() => {
    submitAiReview.mockReset()
    submitAiReview.mockResolvedValue({ error: null })
  })

  /** `evaluation()` fixa sonnet-4-6; aqui a sugestão é sempre da config ATIVA. */
  function renderWithRulers(current: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
  }) {
    render(
      <AiEvaluationReviewForm
        evaluation={
          {
            ...(evaluation(0.75) as unknown as Record<string, unknown>),
            model_name: "claude-sonnet-5",
            prompt_version: "v21",
            created_at: "2026-07-23T10:00:00Z",
          } as never
        }
        workId="w1"
        workTitle="Obra"
        currentScores={CURRENT}
        currentEvaluation={{ ...current, evaluatedAt: "2026-05-21T10:00:00Z", justifications: {} }}
        onSaved={vi.fn()}
      />
    )
  }

  it("avisa quando as duas confianças vieram de modelos diferentes", () => {
    renderWithRulers({ confidence: 0.82, modelName: "claude-sonnet-4-6", promptVersion: "v19" })
    const aviso = screen.getByText(/Réguas diferentes/i).closest("p")?.textContent ?? ""
    // Nomeia as duas procedências, senão o aviso não é acionável.
    expect(aviso).toMatch(/sonnet-4-6\/v19 → sonnet-5\/v21/)
    // Cita o teto pelo MODELO, não pela config: o n=371 agrega v20+v21.
    expect(aviso).toMatch(/O sonnet-5 nunca passou de 88% em 371 avaliações/)
    expect(aviso).not.toMatch(/sonnet-5\/v21 nunca passou/)
    // A procedência também aparece sob cada botão (dois lugares, de propósito).
    expect(screen.getAllByText(/sonnet-4-6\/v19/).length).toBeGreaterThan(1)
  })

  it("NÃO avisa quando a régua é a mesma — a comparação é legítima", () => {
    renderWithRulers({ confidence: 0.7, modelName: "claude-sonnet-5", promptVersion: "v21" })
    expect(screen.queryByText(/Réguas diferentes/i)).toBeNull()
  })

  it("diz 'inalcançável' quando a confiança atual passa do teto do modelo novo", () => {
    // O caso das 50 obras: 93% do sonnet-4-6 contra o teto observado de 88%.
    renderWithRulers({ confidence: 0.93, modelName: "claude-sonnet-4-6", promptVersion: "v17" })
    const aviso = screen.getByText(/Réguas diferentes/i).closest("p")?.textContent ?? ""
    expect(aviso).toMatch(/93%\) é inalcançável pro sonnet-5/)
    expect(aviso).toMatch(/A queda é aritmética, não um sinal de piora/)
  })

  it("não afirma 'inalcançável' quando a confiança atual cabe no teto novo", () => {
    renderWithRulers({ confidence: 0.8, modelName: "claude-sonnet-4-6", promptVersion: "v19" })
    expect(screen.getByText(/Réguas diferentes/i)).toBeTruthy()
    expect(screen.queryByText(/inalcançável/i)).toBeNull()
  })

  it("cala quando a nota atual não veio de IA (sem procedência nenhuma)", () => {
    renderWithRulers({ confidence: null, modelName: null, promptVersion: null })
    expect(screen.queryByText(/Réguas diferentes/i)).toBeNull()
    expect(screen.getByText(/sem avaliação IA/i)).toBeTruthy()
  })
})
