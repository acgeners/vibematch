import { describe, it, expect } from "vitest"
import { buildPlan } from "@/lib/orchestration/planner"
import { emptyReadinessSnapshot, type WorkReadinessSnapshot } from "@/lib/orchestration/readiness"
import { toUiReadiness, checkInferTags } from "@/lib/orchestration/ui-readiness"

/** Snapshot base "pronto p/ Interesse" com overrides. */
function snap(over: Partial<WorkReadinessSnapshot> = {}): WorkReadinessSnapshot {
  return {
    ...emptyReadinessSnapshot(),
    hasWorkRow: true,
    canonical: { present: true, stale: false },
    rawSynopsisCount: 1,
    tagsCount: 5,
    tasteProfile: { present: true, isStub: false, stale: false },
    ratedWorksCount: 50,
    digest: { present: true, stale: false },
    ...over,
  }
}

const ui = (s: WorkReadinessSnapshot) =>
  toUiReadiness("predict_interest_potential", buildPlan("predict_interest_potential", s), s)

describe("toUiReadiness · Interesse", () => {
  it("tudo presente → ready, confiança alta, sem avisos", () => {
    const r = ui(snap())
    expect(r.ready).toBe(true)
    expect(r.blocking).toHaveLength(0)
    expect(r.weakening).toHaveLength(0)
    expect(r.confidence).toBe("alta")
  })

  it("sem NENHUMA sinopse → bloqueia (precondição)", () => {
    const r = ui(snap({ canonical: { present: false, stale: false }, rawSynopsisCount: 0 }))
    expect(r.ready).toBe(false)
    expect(r.blocking.length).toBeGreaterThan(0)
    expect(r.confidence).toBe("baixa")
  })

  it("só sinopse bruta (sem canônica) → NÃO bloqueia (usa fallback)", () => {
    const r = ui(snap({ canonical: { present: false, stale: false }, rawSynopsisCount: 2 }))
    expect(r.ready).toBe(true)
    // canonical caiu em fallback → ajuda (softMissing), não âmbar.
    expect(r.softMissing.some((i) => i.dataKey === "canonical_synopsis")).toBe(true)
    expect(r.weakening).toHaveLength(0)
    expect(r.confidence).toBe("média")
  })

  it("perfil stub + <10 obras rotuladas → bloqueia", () => {
    const r = ui(snap({ tasteProfile: { present: true, isStub: true, stale: false }, ratedWorksCount: 4 }))
    expect(r.ready).toBe(false)
    expect(r.blocking.length).toBeGreaterThan(0)
  })

  it("sem resumo de reviews → âmbar (importa), confiança média", () => {
    const r = ui(snap({ digest: { present: false, stale: false }, summary: { present: false, stale: false } }))
    expect(r.ready).toBe(true)
    expect(r.weakening.some((i) => i.dataKey === "review_digest")).toBe(true)
    expect(r.confidence).toBe("média")
  })

  it("sem tags → ajuda (selo), não âmbar", () => {
    const r = ui(snap({ tagsCount: 0 }))
    expect(r.ready).toBe(true)
    expect(r.softMissing.some((i) => i.dataKey === "tags")).toBe(true)
    expect(r.weakening).toHaveLength(0)
    expect(r.confidence).toBe("média")
  })
})

const uiV = (s: WorkReadinessSnapshot) =>
  toUiReadiness("run_alignment", buildPlan("run_alignment", s), s)

describe("toUiReadiness · Veredito (run_alignment, sem inputs no contrato)", () => {
  it("perfil ok + 9 attrs + sinopse + digest → ready, alta", () => {
    const r = uiV(snap({ categoryScoresAiCount: 9 }))
    expect(r.ready).toBe(true)
    expect(r.weakening).toHaveLength(0)
    expect(r.confidence).toBe("alta")
  })

  it("perfil stub → bloqueia (HARD de UI, fora do contrato)", () => {
    const r = uiV(snap({ categoryScoresAiCount: 9, tasteProfile: { present: true, isStub: true, stale: false } }))
    expect(r.ready).toBe(false)
    expect(r.blocking.some((b) => b.dataKey === "taste_profile")).toBe(true)
  })

  it("sem perfil → bloqueia", () => {
    const r = uiV(snap({ categoryScoresAiCount: 9, tasteProfile: { present: false, isStub: false, stale: false } }))
    expect(r.ready).toBe(false)
  })

  it("sem avaliação IA (attrs<9) → âmbar (importa), confiança média", () => {
    const r = uiV(snap({ categoryScoresAiCount: 0 }))
    expect(r.ready).toBe(true)
    expect(r.weakening.some((i) => i.dataKey === "category_scores_ai")).toBe(true)
    expect(r.confidence).toBe("média")
  })
})

describe("checkInferTags · Inferir tags (fora do motor)", () => {
  it("sinopse ≥80 + contexto de reviews → ready, alta", () => {
    const r = checkInferTags({ maxSynopsisChars: 300, hasReviewContext: true })
    expect(r.ready).toBe(true)
    expect(r.confidence).toBe("alta")
    expect(r.action).toBe("infer_tags")
  })

  it("sinopse <80 → bloqueia (o gerador pularia em silêncio)", () => {
    const r = checkInferTags({ maxSynopsisChars: 40, hasReviewContext: true })
    expect(r.ready).toBe(false)
    expect(r.blocking).toHaveLength(1)
    expect(r.confidence).toBe("baixa")
  })

  it("exatamente 80 → passa (limiar inclusivo)", () => {
    expect(checkInferTags({ maxSynopsisChars: 80, hasReviewContext: false }).ready).toBe(true)
  })

  it("sinopse ok mas sem contexto de reviews → ready, média (ajuda no selo)", () => {
    const r = checkInferTags({ maxSynopsisChars: 300, hasReviewContext: false })
    expect(r.ready).toBe(true)
    expect(r.softMissing.some((i) => i.dataKey === "review_digest")).toBe(true)
    expect(r.confidence).toBe("média")
  })
})
