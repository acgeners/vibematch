import { describe, it, expect } from "vitest"
import { describeGenerateAll, type GenerateAllPieces, type GenerateAllWorkState } from "@/lib/generate-all/work-pieces"
import { interestPredictLabel } from "@/lib/ui/interest-predict-label"
import { WORK_ACTION_LABELS, reviewsSynthesisLabel } from "@/lib/ui/work-action-labels"
import { MIN_USEFUL_REVIEWS_FOR_EVAL } from "@/lib/ai-evaluation/eval-evidence"

const ALL: GenerateAllPieces = {
  synopsis: true,
  summary: true,
  digest: true,
  tags: true,
  scores: true,
  interest: true,
  verdict: true,
  embedding: true,
}

function state(over: Partial<GenerateAllPieces> = {}, extra: Partial<GenerateAllWorkState> = {}): GenerateAllWorkState {
  return { pieces: { ...ALL, ...over }, reviewPending: false, usefulReviews: 20, estimatedUsd: 0.13, ...extra }
}

/**
 * A aparência do "Gerar tudo" e o conteúdo do cartão. A régua é "tem nota": só a obra sem
 * notas é o caso da cascata (3 de 1.083 em 13/11/2026); nas outras ela refaz o que existe.
 */
describe("Gerar tudo — o que a obra já tem", () => {
  it("🔴 obra com notas vira 'Refazer tudo'; sem notas continua 'Gerar tudo'", () => {
    expect(describeGenerateAll(state()).mode).toBe("redo")
    expect(describeGenerateAll(state()).label).toBe("Refazer tudo")
    const semNotas = describeGenerateAll(state({ scores: false, interest: false, verdict: false }))
    expect(semNotas.mode).toBe("generate")
    expect(semNotas.label).toBe("Gerar tudo")
    expect(semNotas.advice).toEqual({ kind: "generate", fewReviews: null })
  })

  it("conta as peças prontas na ordem da cascata", () => {
    const v = describeGenerateAll(state({ interest: false, verdict: false }))
    expect(v.ready).toBe(6)
    expect(v.total).toBe(8)
    expect(v.rows.map((r) => r.key)).toEqual([
      "synopsis",
      "summary",
      "digest",
      "tags",
      "scores",
      "interest",
      "verdict",
      "embedding",
    ])
  })

  it("🔴 o que falta aponta o botão da peça, pelo MESMO rótulo que o botão usa", () => {
    const v = describeGenerateAll(state({ interest: false, verdict: false }))
    expect(v.advice.kind).toBe("missing")
    if (v.advice.kind !== "missing") return
    expect(v.advice.missing.map((m) => [m.key, m.action])).toEqual([
      ["interest", interestPredictLabel({ hasPrediction: false, stale: false })],
      ["verdict", WORK_ACTION_LABELS.calculateVerdict],
    ])
  })

  it("resumo e síntese faltando viram UMA linha (o mesmo botão faz as duas)", () => {
    const v = describeGenerateAll(state({ summary: false, digest: false }))
    if (v.advice.kind !== "missing") throw new Error(v.advice.kind)
    expect(v.advice.missing).toHaveLength(1)
    expect(v.advice.missing[0]).toMatchObject({
      key: "summary",
      label: "Resumo e síntese das reviews",
      action: reviewsSynthesisLabel(false),
    })
  })

  it("só a síntese faltando aponta 'Destilar'; abaixo do piso, diz que recusaria", () => {
    const ok = describeGenerateAll(state({ digest: false }))
    if (ok.advice.kind !== "missing") throw new Error(ok.advice.kind)
    expect(ok.advice.missing[0]).toMatchObject({ key: "digest", action: reviewsSynthesisLabel(true), blocked: null })

    const poucas = describeGenerateAll(state({ digest: false }, { usefulReviews: 2 }))
    if (poucas.advice.kind !== "missing") throw new Error(poucas.advice.kind)
    expect(poucas.advice.missing[0].blocked).toMatch(/precisa de 4 reviews úteis/)
  })

  it("🔴 avaliação esperando revisão vem antes do que falta (refazer a descartaria)", () => {
    const v = describeGenerateAll(state({ verdict: false }, { reviewPending: true }))
    expect(v.mode).toBe("redo")
    expect(v.advice.kind).toBe("review")
    if (v.advice.kind !== "review") return
    expect(v.advice.missing.map((m) => m.key)).toEqual(["verdict"])
  })

  it("obra completa não aponta peça nenhuma", () => {
    expect(describeGenerateAll(state()).advice).toEqual({ kind: "complete" })
  })

  it("🔴 sem notas e com poucas reviews: é o caso, mas ainda não vale", () => {
    const v = describeGenerateAll(state({ scores: false }, { usefulReviews: 1 }))
    expect(v.fewReviews).toBe(true)
    expect(v.advice).toEqual({ kind: "generate", fewReviews: { useful: 1, min: MIN_USEFUL_REVIEWS_FOR_EVAL } })
  })

  it("contagem de reviews ilegível não acusa 'poucas'", () => {
    const v = describeGenerateAll(state({ scores: false }, { usefulReviews: null }))
    expect(v.fewReviews).toBe(false)
    expect(v.advice).toEqual({ kind: "generate", fewReviews: null })
  })
})
