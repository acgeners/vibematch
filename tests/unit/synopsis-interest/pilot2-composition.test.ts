import { describe, it, expect } from "vitest"
import {
  STRATA,
  SPLITS,
  computeCarryoverComposition,
  distributeStrataQuotaBalanced,
  computeSplitTargets,
  computeCompositionPlan,
  validateComposition,
  distributeRepeats,
  type CarryoverWork,
  type Split,
  type Stratum,
} from "@/lib/synopsis-interest/pilot2-composition"

// Matriz REAL dos 51 carryovers (Parte C): dev ♥7 ♥♥13 ♥♥♥10 ♥♥♥♥3 · hold ♥3 ♥♥6 ♥♥♥4 ♥♥♥♥5
const REAL: Record<Split, Record<Stratum, number>> = {
  development: { "♥": 7, "♥♥": 13, "♥♥♥": 10, "♥♥♥♥": 3 },
  holdout: { "♥": 3, "♥♥": 6, "♥♥♥": 4, "♥♥♥♥": 5 },
}
function realCarryoverWorks(): CarryoverWork[] {
  const out: CarryoverWork[] = []
  for (const sp of SPLITS) for (const s of STRATA) for (let i = 0; i < REAL[sp][s]; i++) out.push({ split: sp, stratum: s })
  return out
}

describe("pilot2-composition — carryover (Parte C)", () => {
  it("compõe split/stratum/matriz dos 51 carryovers", () => {
    const c = computeCarryoverComposition(realCarryoverWorks())
    expect(c.total).toBe(51)
    expect(c.bySplit).toEqual({ development: 33, holdout: 18 })
    expect(c.byStratum).toEqual({ "♥": 10, "♥♥": 19, "♥♥♥": 14, "♥♥♥♥": 8 })
    expect(c.matrix).toEqual(REAL)
  })

  it("8. independe da ORDEM de entrada", () => {
    const works = realCarryoverWorks()
    const a = computeCarryoverComposition(works)
    const b = computeCarryoverComposition([...works].reverse())
    expect(b).toEqual(a)
  })

  it("9. labels / outputs de candidato NÃO fazem parte das entradas", () => {
    const works = realCarryoverWorks().map((w) => ({ ...w, humanLabel: "♥♥♥♥", prediction: 9.9, alignment: 7 }))
    // campos extras são ignorados → mesma composição
    const a = computeCarryoverComposition(works as CarryoverWork[])
    const b = computeCarryoverComposition(realCarryoverWorks())
    expect(a).toEqual(b)
  })
})

describe("pilot2-composition — Opção 1 (balanced, dev 56 / hold 34)", () => {
  const carryover = computeCarryoverComposition(realCarryoverWorks())
  const splitTargets = computeSplitTargets(90, 56, 34)
  const plan = computeCompositionPlan({ total: 90, splitTargets, carryover, strataMode: "balanced" })

  it("1. 51 + 39 = 90", () => {
    expect(carryover.total + plan.totalNew).toBe(90)
    expect(plan.totalNew).toBe(39)
  })
  it("2. 33 + 23 = 56 development", () => {
    expect(carryover.bySplit.development + plan.splitDeficit.development).toBe(56)
    expect(plan.splitDeficit.development).toBe(23)
  })
  it("3. 18 + 16 = 34 holdout", () => {
    expect(carryover.bySplit.holdout + plan.splitDeficit.holdout).toBe(34)
    expect(plan.splitDeficit.holdout).toBe(16)
  })
  it("4. quotas somam exatamente 90", () => {
    expect(STRATA.reduce((a, s) => a + plan.stratumTargets[s], 0)).toBe(90)
    expect(plan.splitTargets.development + plan.splitTargets.holdout).toBe(90)
    // regra determinística: +1 aos de menor déficit-base (♥♥, ♥♥♥)
    expect(plan.stratumTargets).toEqual({ "♥": 22, "♥♥": 23, "♥♥♥": 23, "♥♥♥♥": 22 })
  })
  it("5. déficits nunca negativos", () => {
    for (const sp of SPLITS) for (const s of STRATA) expect(plan.cellDeficit[sp][s]).toBeGreaterThanOrEqual(0)
    // stratum deficits
    expect(plan.stratumDeficit).toEqual({ "♥": 12, "♥♥": 4, "♥♥♥": 9, "♥♥♥♥": 14 })
  })
  it("6. matriz split×stratum soma corretamente (colunas=split, linhas=stratum) e déficit de célula = 39", () => {
    // colunas
    expect(STRATA.reduce((a, s) => a + plan.cellTargets.development[s], 0)).toBe(56)
    expect(STRATA.reduce((a, s) => a + plan.cellTargets.holdout[s], 0)).toBe(34)
    // linhas = stratum target
    for (const s of STRATA) expect(plan.cellTargets.development[s] + plan.cellTargets.holdout[s]).toBe(plan.stratumTargets[s])
    // déficit de célula real esperado
    expect(plan.cellDeficit.development).toEqual({ "♥": 7, "♥♥": 1, "♥♥♥": 4, "♥♥♥♥": 11 })
    expect(plan.cellDeficit.holdout).toEqual({ "♥": 5, "♥♥": 3, "♥♥♥": 5, "♥♥♥♥": 3 })
    const sum = SPLITS.reduce((a, sp) => a + STRATA.reduce((b, s) => b + plan.cellDeficit[sp][s], 0), 0)
    expect(sum).toBe(39)
  })
  it("validação passa", () => {
    expect(validateComposition(plan, carryover)).toEqual({ ok: true, errors: [] })
  })
})

describe("pilot2-composition — Opção 2 (proporcional / minimiza alteração)", () => {
  const carryover = computeCarryoverComposition(realCarryoverWorks())
  const plan = computeCompositionPlan({ total: 90, splitTargets: computeSplitTargets(90, 56, 34), carryover, strataMode: "proportional" })
  it("preserva a forma dos carryovers (extremos mais leves)", () => {
    expect(plan.stratumTargets).toEqual({ "♥": 18, "♥♥": 33, "♥♥♥": 25, "♥♥♥♥": 14 })
    expect(STRATA.reduce((a, s) => a + plan.stratumTargets[s], 0)).toBe(90)
    expect(plan.stratumDeficit).toEqual({ "♥": 8, "♥♥": 14, "♥♥♥": 11, "♥♥♥♥": 6 })
    expect(validateComposition(plan, carryover).ok).toBe(true)
  })
})

describe("pilot2-composition — robustez / regras", () => {
  it("7. repetições NÃO contam como obras únicas (composição segue 90)", () => {
    const rep = distributeRepeats(10, 6, 4)
    expect(rep.development + rep.holdout).toBe(10)
    const carryover = computeCarryoverComposition(realCarryoverWorks())
    const plan = computeCompositionPlan({ total: 90, splitTargets: computeSplitTargets(90, 56, 34), carryover, strataMode: "balanced" })
    expect(plan.total).toBe(90) // repeats não somam ao total de únicas
  })

  it("10. composição inválida é rejeitada", () => {
    expect(() => computeSplitTargets(90, 50, 30)).toThrow() // 50+30 != 90
    const carryover = computeCarryoverComposition(realCarryoverWorks())
    const plan = computeCompositionPlan({ total: 90, splitTargets: computeSplitTargets(90, 56, 34), carryover, strataMode: "balanced" })
    const tampered = { ...plan, stratumTargets: { ...plan.stratumTargets, "♥": 0 } }
    expect(validateComposition(tampered, carryover).ok).toBe(false)
  })

  it("déficit clampa em 0 quando carryover excede o alvo", () => {
    const carryover = computeCarryoverComposition([
      ...Array(40).fill({ split: "development", stratum: "♥♥" } as CarryoverWork),
    ])
    const plan = computeCompositionPlan({ total: 90, splitTargets: computeSplitTargets(90, 56, 34), carryover, strataMode: "balanced" })
    // ♥♥ dev carryover 40 > qualquer alvo de célula → déficit 0 (não negativo)
    expect(plan.cellDeficit.development["♥♥"]).toBe(0)
  })

  it("distributeStrataQuotaBalanced é determinística e soma o total", () => {
    const q = distributeStrataQuotaBalanced(90, { "♥": 10, "♥♥": 19, "♥♥♥": 14, "♥♥♥♥": 8 })
    expect(STRATA.reduce((a, s) => a + q[s], 0)).toBe(90)
    expect(distributeStrataQuotaBalanced(90, { "♥": 10, "♥♥": 19, "♥♥♥": 14, "♥♥♥♥": 8 })).toEqual(q)
  })
})
