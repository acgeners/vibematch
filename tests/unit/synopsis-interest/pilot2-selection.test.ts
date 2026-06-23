import { describe, it, expect } from "vitest"
import {
  SELECTION_SEED,
  CELL_QUOTA,
  selectNewWorks,
  selectRepeats,
  evaluateReviewsGate,
  buildPilot2Definition,
  validatePilot2Definition,
  canonicalListHash,
  type EligibleWork,
  type SelectedWork,
  type CarryoverEntry,
} from "@/lib/synopsis-interest/pilot2-selection"
import { STRATA, SPLITS, type Split, type Stratum } from "@/lib/synopsis-interest/pilot2-composition"
import { computeLabelDisplaySignature, labelDisplayContentFromWork } from "@/lib/synopsis-interest/label-reuse"

// pool sintético: `counts` elegíveis por stratum
function pool(counts: Record<Stratum, number>): EligibleWork[] {
  const out: EligibleWork[] = []
  for (const s of STRATA) for (let i = 0; i < counts[s]; i++) out.push({ workId: `new-${s}-${String(i).padStart(3, "0")}`, stratum: s })
  return out
}
const FEASIBLE: Record<Stratum, number> = { "♥": 14, "♥♥": 193, "♥♥♥": 175, "♥♥♥♥": 39 } // pool real

// carryovers reais (matriz Parte C)
const CARRY_MATRIX: Record<Split, Record<Stratum, number>> = {
  development: { "♥": 7, "♥♥": 13, "♥♥♥": 10, "♥♥♥♥": 3 },
  holdout: { "♥": 3, "♥♥": 6, "♥♥♥": 4, "♥♥♥♥": 5 },
}
function carryovers(): CarryoverEntry[] {
  const out: CarryoverEntry[] = []
  for (const sp of SPLITS) for (const s of STRATA) for (let i = 0; i < CARRY_MATRIX[sp][s]; i++) out.push({ workId: `carry-${sp}-${s}-${i}`, stratum: s, split: sp })
  return out
}

function cellCounts(selected: SelectedWork[]): Record<Split, Record<Stratum, number>> {
  const m: Record<Split, Record<Stratum, number>> = {
    development: { "♥": 0, "♥♥": 0, "♥♥♥": 0, "♥♥♥♥": 0 },
    holdout: { "♥": 0, "♥♥": 0, "♥♥♥": 0, "♥♥♥♥": 0 },
  }
  for (const w of selected) m[w.split][w.stratum]++
  return m
}

describe("pilot2-selection — seleção das 39", () => {
  const r = selectNewWorks({ pool: pool(FEASIBLE) })

  it("1. quotas exatas por split × stratum (matriz aprovada)", () => {
    expect(r.ok).toBe(true)
    expect(cellCounts(r.selected)).toEqual(CELL_QUOTA)
  })
  it("8. exatamente 39 IDs únicos", () => {
    expect(r.selected).toHaveLength(39)
    expect(new Set(r.selected.map((w) => w.workId)).size).toBe(39)
  })
  it("9/10. todos os selecionados vêm do pool (unread/ativo já filtrado a montante)", () => {
    const poolIds = new Set(pool(FEASIBLE).map((w) => w.workId))
    expect(r.selected.every((w) => poolIds.has(w.workId))).toBe(true)
  })
  it("2. independe da ORDEM retornada pelo banco", () => {
    const shuffled = [...pool(FEASIBLE)].reverse()
    const r2 = selectNewWorks({ pool: shuffled })
    expect(r2.selected).toEqual(r.selected)
    expect(r2.canonicalListHash).toBe(r.canonicalListHash)
  })
  it("3. mesma seed → mesma seleção", () => {
    expect(selectNewWorks({ pool: pool(FEASIBLE), seed: SELECTION_SEED }).canonicalListHash).toBe(r.canonicalListHash)
  })
  it("4. seed diferente altera a seleção deterministicamente", () => {
    const r2 = selectNewWorks({ pool: pool(FEASIBLE), seed: "outro-seed-v9" })
    expect(r2.ok).toBe(true)
    expect(r2.canonicalListHash).not.toBe(r.canonicalListHash)
    // mas continua determinística
    expect(selectNewWorks({ pool: pool(FEASIBLE), seed: "outro-seed-v9" }).canonicalListHash).toBe(r2.canonicalListHash)
  })
  it("5/6. labels/reviews/digests NÃO fazem parte das entradas (campos extras ignorados)", () => {
    const contaminated = pool(FEASIBLE).map((w) => ({ ...w, humanLabel: "♥♥♥♥", reviewCount: 99, hasDigest: true, prediction: 9 }))
    const r2 = selectNewWorks({ pool: contaminated as EligibleWork[] })
    expect(r2.canonicalListHash).toBe(r.canonicalListHash)
  })
  it("7. quantidade insuficiente em QUALQUER stratum bloqueia tudo (sem seleção parcial)", () => {
    const short = selectNewWorks({ pool: pool({ "♥": 11, "♥♥": 193, "♥♥♥": 175, "♥♥♥♥": 39 }) }) // ♥ 11 < 12
    expect(short.ok).toBe(false)
    expect(short.selected).toEqual([])
    expect(short.deficits).toEqual([{ stratum: "♥", available: 11, quota: 12, deficit: 1 }])
  })
  it("reserva por stratum = elegíveis − quota", () => {
    expect(r.reservesByStratum).toEqual({ "♥": 14 - 12, "♥♥": 193 - 4, "♥♥♥": 175 - 9, "♥♥♥♥": 39 - 14 })
  })
})

describe("pilot2-selection — repeats (10)", () => {
  const sel = selectNewWorks({ pool: pool(FEASIBLE) })
  const rep = selectRepeats({ newSelected: sel.selected })

  it("11. 10 obras distintas", () => {
    expect(rep.ok).toBe(true)
    expect(rep.repeats).toHaveLength(10)
    expect(new Set(rep.repeats.map((x) => x.workId)).size).toBe(10)
  })
  it("12. 6 development / 4 holdout", () => {
    expect(rep.repeats.filter((x) => x.split === "development")).toHaveLength(6)
    expect(rep.repeats.filter((x) => x.split === "holdout")).toHaveLength(4)
  })
  it("13. cada repeat fica no split da obra original", () => {
    const splitById = new Map(sel.selected.map((w) => [w.workId, w.split]))
    for (const x of rep.repeats) expect(x.split).toBe(splitById.get(x.workId))
  })
  it("repeats só entre as 39 novas; seed diferente do de seleção", () => {
    const newIds = new Set(sel.selected.map((w) => w.workId))
    expect(rep.repeats.every((x) => newIds.has(x.workId))).toBe(true)
    expect(rep.seed).not.toBe(sel.seed)
  })
  it("distribuição determinística e respeita capacidade das células", () => {
    const total = SPLITS.reduce((a, sp) => a + STRATA.reduce((b, s) => b + rep.distribution[sp][s], 0), 0)
    expect(total).toBe(10)
    expect(selectRepeats({ newSelected: sel.selected }).canonicalListHash).toBe(rep.canonicalListHash)
  })
})

describe("pilot2-selection — definição do pilot-2", () => {
  const sel = selectNewWorks({ pool: pool(FEASIBLE) })
  const rep = selectRepeats({ newSelected: sel.selected })
  const def = buildPilot2Definition({ carryovers: carryovers(), newSelected: sel.selected, repeats: rep.repeats })

  it("15. 90 únicas / 100 slots", () => {
    expect(def.uniqueWorks).toBe(90)
    expect(def.totalSlots).toBe(100)
  })
  it("14. repeats NÃO contam como obras únicas", () => {
    const primary = def.slots.filter((s) => !s.isRepeat)
    expect(primary).toHaveLength(90)
    expect(def.slots.filter((s) => s.isRepeat)).toHaveLength(10)
  })
  it("16. composição final 56 / 34", () => {
    expect(def.splitTotals).toEqual({ development: 56, holdout: 34 })
  })
  it("17. strata finais 22 / 23 / 23 / 22", () => {
    expect(def.stratumTotals).toEqual({ "♥": 22, "♥♥": 23, "♥♥♥": 23, "♥♥♥♥": 22 })
  })
  it("18. carryovers preservam origem (derivados de base-1 no script)", () => {
    const carry = def.slots.filter((s) => !s.isRepeat && s.origin === "carryover")
    expect(carry).toHaveLength(51)
  })
  it("repeat slots apontam para o slot da obra original", () => {
    for (const m of def.repeatMap) {
      const orig = def.slots.find((s) => !s.isRepeat && s.workId === m.workId)
      expect(orig?.slotKey).toBe(m.originalSlot)
    }
  })
  it("validatePilot2Definition aprova a composição", () => {
    expect(validatePilot2Definition(def)).toEqual({ ok: true, errors: [] })
  })
  it("validação rejeita composição inválida", () => {
    const bad = { ...def, splitTotals: { development: 55, holdout: 35 } }
    expect(validatePilot2Definition(bad).ok).toBe(false)
  })
})

describe("pilot2-selection — gate de reviews (base-2)", () => {
  it("20. review >30d bloqueia base-2 SEM trocar a obra; no_reviews e ≤30d passam", () => {
    const works = [
      { workId: "a", hasUsefulReviews: false, maxFetchAgeDays: null }, // no_reviews → ok
      { workId: "b", hasUsefulReviews: true, maxFetchAgeDays: 12 }, // fresh → ok
      { workId: "c", hasUsefulReviews: true, maxFetchAgeDays: 45 }, // >30d → blocker
      { workId: "d", hasUsefulReviews: true, maxFetchAgeDays: null }, // sem data → blocker
    ]
    const g = evaluateReviewsGate(works)
    expect(g.ok).toBe(false)
    expect(g.noReviews).toBe(1)
    expect(g.freshWithReviews).toBe(1)
    expect(g.blockers.map((b) => b.workId).sort()).toEqual(["c", "d"])
  })
  it("gate ok quando todas no_reviews ou ≤30d", () => {
    const g = evaluateReviewsGate([
      { workId: "a", hasUsefulReviews: false, maxFetchAgeDays: null },
      { workId: "b", hasUsefulReviews: true, maxFetchAgeDays: 5 },
    ])
    expect(g.ok).toBe(true)
  })
})

describe("pilot2-selection — assinatura de display (Parte H)", () => {
  it("19. label e reading status NÃO entram na assinatura de display", () => {
    const base = labelDisplayContentFromWork({
      synopsis: "x",
      contextualTags: ["a", "b"],
      reviewContextType: "no_reviews_available",
      sanitizedDigest: null,
    })
    const contaminated = { ...base, humanLabel: "♥♥♥♥", readingStatus: "unread", workId: "z" } as typeof base
    expect(computeLabelDisplaySignature(contaminated)).toBe(computeLabelDisplaySignature(base))
  })
})

describe("pilot2-selection — hash canônico", () => {
  it("canonicalListHash independe da ordem", () => {
    expect(canonicalListHash(["b", "a", "c"])).toBe(canonicalListHash(["c", "a", "b"]))
  })
})
