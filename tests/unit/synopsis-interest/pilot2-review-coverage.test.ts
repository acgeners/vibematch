import { describe, it, expect } from "vitest"
import {
  buildPilot2CoveragePanel,
  parseCoverageUnder2Csv,
  MIN_USEFUL_TARGET,
  HISTORICAL_COVERAGE_BASELINE,
  COVERAGE_TARGET_WORKS,
  evaluateLiveCoverage,
  type CoverageLiveRow,
} from "@/lib/synopsis-interest/pilot2-review-coverage"

/** 13 obras-alvo, todas ≥2 (estado ATUAL ratificado). */
function ratifiedRows(): CoverageLiveRow[] {
  const counts = [2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 7, 11, 12] // = estado atual real
  return counts.map((n, i) => ({ workId: `w${i}`, usefulBeforeDedupe: n, usefulAfterDedupe: n }))
}

describe("pilot2-review-coverage — painel das obras com <2 úteis", () => {
  it("calcula missingToTarget e rota local; 2 úteis ⇒ falta 0", () => {
    const panel = buildPilot2CoveragePanel([
      { title: "Z", workId: "w0", usefulReviewCount: 0, acceptedExternalSources: ["comix"], split: "development", stratum: "♥" },
      { title: "A", workId: "w1", usefulReviewCount: 1, acceptedExternalSources: ["anilist", "comix"], split: "holdout", stratum: "♥♥" },
      { title: "B", workId: "w2", usefulReviewCount: 2, acceptedExternalSources: ["kitsu"], split: "development", stratum: "♥♥♥" },
    ])
    expect(MIN_USEFUL_TARGET).toBe(2)
    const byId = Object.fromEntries(panel.rows.map((r) => [r.workId, r]))
    expect(byId.w0.missingToTarget).toBe(2)
    expect(byId.w1.missingToTarget).toBe(1)
    expect(byId.w2.missingToTarget).toBe(0) // 23. duas úteis satisfazem a cobertura
    expect(byId.w0.localRoute).toBe("/titles/w0")
    expect(byId.w1.availableExternalSources).toEqual(["anilist", "comix"])
    expect(panel.summary).toMatchObject({ zeroUseful: 1, oneUseful: 1, total: 3, totalMissing: 3 })
  })

  it("baseline histórico PRESERVADO (9/4/0/22/0) + 13 obras-alvo", () => {
    expect(HISTORICAL_COVERAGE_BASELINE).toMatchObject({ zeroUseful: 9, oneUseful: 4, twoPlus: 0, totalMissing: 22, manualRows: 0 })
    expect(COVERAGE_TARGET_WORKS).toBe(13)
  })

  it("estado ATUAL (13/13 ≥2) → 0/0/13, 0 faltantes, todas invariantes OK (progresso ≠ divergência)", () => {
    const r = evaluateLiveCoverage(ratifiedRows())
    expect(r.current).toMatchObject({ zeroUseful: 0, oneUseful: 0, twoPlus: 13, totalMissing: 0, canonicalDups: 0 })
    expect(r.ok).toBe(true)
    expect(r.invariants.every((i) => i.pass)).toBe(true)
  })

  it("DIVERGÊNCIA REAL: obra-alvo <2 após meta ratificada → falha", () => {
    const rows = ratifiedRows()
    rows[0] = { ...rows[0], usefulBeforeDedupe: 1, usefulAfterDedupe: 1 }
    const r = evaluateLiveCoverage(rows)
    expect(r.ok).toBe(false)
    expect(r.invariants.find((i) => i.name.includes("≥2"))?.pass).toBe(false)
    expect(r.invariants.find((i) => i.name.includes("faltantes"))?.pass).toBe(false)
  })

  it("DIVERGÊNCIA REAL: nº de obras-alvo ≠ 13 → falha", () => {
    const r = evaluateLiveCoverage(ratifiedRows().slice(0, 12))
    expect(r.ok).toBe(false)
    expect(r.invariants.find((i) => i.name.includes("obras-alvo"))?.pass).toBe(false)
  })

  it("DIVERGÊNCIA REAL: duplicata canônica inesperada (antes>depois) → falha", () => {
    const rows = ratifiedRows()
    rows[5] = { ...rows[5], usefulBeforeDedupe: 5, usefulAfterDedupe: 4 } // 1 texto perdido no dedupe
    const r = evaluateLiveCoverage(rows)
    expect(r.current.canonicalDups).toBe(1)
    expect(r.ok).toBe(false)
    expect(r.invariants.find((i) => i.name.includes("duplicatas"))?.pass).toBe(false)
  })

  it("não-ratificado (uso pré-meta): não exige ≥2 — só conta/dup/agregado", () => {
    const rows: CoverageLiveRow[] = [
      { workId: "a", usefulBeforeDedupe: 0, usefulAfterDedupe: 0 },
      { workId: "b", usefulBeforeDedupe: 1, usefulAfterDedupe: 1 },
    ]
    const r = evaluateLiveCoverage(rows, { ratified: false })
    expect(r.invariants.some((i) => i.name.includes("≥2"))).toBe(false) // sem invariante de cobertura
    expect(r.current).toMatchObject({ zeroUseful: 1, oneUseful: 1, twoPlus: 0 })
  })

  it("parser tolera `;` dentro de campo aspado e separa fontes por `|`", () => {
    const csv = [
      "title;useful_review_count;total_reviews_persisted;current_sources;accepted_external_sources;split;stratum;tech_note;work_id;url",
      'Obra X;0;0;;anilist|comix;development;♥♥♥;"sem reviews; tem fontes";abc-123;http://localhost:3001/titles/abc-123',
    ].join("\n")
    const rows = parseCoverageUnder2Csv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: "Obra X", workId: "abc-123", usefulReviewCount: 0, split: "development", stratum: "♥♥♥" })
    expect(rows[0].acceptedExternalSources).toEqual(["anilist", "comix"])
  })
})
