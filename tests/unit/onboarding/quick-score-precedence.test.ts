import { describe, it, expect } from "vitest"
import { resolveQuickScoreEffect } from "@/lib/onboarding/quick-score-precedence"

const base = { prevQuickScore: null, prevUserScore: null, fichaExists: false, canRate: true }

describe("nota rápida — precedência (ficha sempre vence)", () => {
  it("sem ficha: write-through — primeira nota vira rótulo", () => {
    const e = resolveQuickScoreEffect({ ...base, score: 8 })
    expect(e.patch).toEqual({ quick_score: 8, user_score: 8 })
    expect(e.labelChange).toBe("first")
  })

  it("sem ficha, rótulo já era o quick: mudar atualiza os dois", () => {
    const e = resolveQuickScoreEffect({ ...base, score: 6, prevQuickScore: 8, prevUserScore: 8 })
    expect(e.patch).toEqual({ quick_score: 6, user_score: 6 })
    expect(e.labelChange).toBe("updated")
  })

  it("mesmo valor: nada de churn de ledger/recalc", () => {
    const e = resolveQuickScoreEffect({ ...base, score: 8, prevQuickScore: 8, prevUserScore: 8 })
    expect(e.labelChange).toBe("none")
  })

  it("COM ficha: quick é guardada mas o rótulo é INTOCADO", () => {
    const e = resolveQuickScoreEffect({
      ...base,
      score: 4,
      fichaExists: true,
      prevUserScore: 9.1,
    })
    expect(e.patch).toEqual({ quick_score: 4 })
    expect(e.labelChange).toBe("none")
  })

  it("gate de leitura reprovado: guarda a quick, não rotula", () => {
    const e = resolveQuickScoreEffect({ ...base, score: 8, canRate: false })
    expect(e.patch).toEqual({ quick_score: 8 })
    expect(e.labelChange).toBe("none")
  })

  it("sobrescreve rótulo de import (ação direta no app vence import)", () => {
    const e = resolveQuickScoreEffect({ ...base, score: 8, prevUserScore: 7 })
    expect(e.patch).toEqual({ quick_score: 8, user_score: 8 })
    expect(e.labelChange).toBe("updated")
  })

  it("remover: desfaz o rótulo SÓ se ele veio do quick", () => {
    const e = resolveQuickScoreEffect({ ...base, score: null, prevQuickScore: 8, prevUserScore: 8 })
    expect(e.patch).toEqual({ quick_score: null, user_score: null })
    expect(e.labelChange).toBe("removed")
  })

  it("remover NÃO destrói rótulo importado (sem quick anterior)", () => {
    const e = resolveQuickScoreEffect({ ...base, score: null, prevUserScore: 7 })
    expect(e.patch).toEqual({ quick_score: null })
    expect(e.labelChange).toBe("none")
  })

  it("remover não toca rótulo de ficha", () => {
    const e = resolveQuickScoreEffect({
      ...base,
      score: null,
      prevQuickScore: 8,
      prevUserScore: 9.1,
      fichaExists: true,
    })
    expect(e.patch).toEqual({ quick_score: null })
    expect(e.labelChange).toBe("none")
  })
})
