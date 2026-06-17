import { describe, it, expect } from "vitest"
import {
  errorStats,
  computeProspectiveSummary,
  computeErrorByScoreBand,
  computeErrorByFormula,
  computeErrorByPeriod,
  computeBaselines,
  computeBaselinesOnCommonSubset,
  computeSnapshotStats,
  medianResolutionLatencyMs,
  selectPrimaryPredictionPerWork,
  selectPrimaryPredictionPerWorkAndFormula,
  type ResolvedSnapshot,
  type SnapshotStatsRow,
} from "@/lib/metrics/prediction-metrics"

function snap(p: Partial<ResolvedSnapshot> & { actual: number }): ResolvedSnapshot {
  return {
    workId: p.workId ?? "w1",
    capturedAt: p.capturedAt ?? "2026-06-10T00:00:00.000Z",
    resolvedAt: p.resolvedAt ?? "2026-06-17T00:00:00.000Z",
    superseded: p.superseded ?? false,
    predictedIsStub: p.predictedIsStub ?? false,
    actual: p.actual,
    predictedScore: p.predictedScore ?? null,
    calcScore: p.calcScore ?? null,
    decisionScore: p.decisionScore ?? null,
    formulaVersion: p.formulaVersion ?? "v9",
    trainingSampleSize: p.trainingSampleSize ?? null,
  }
}

describe("errorStats", () => {
  it("MAE e RMSE corretos", () => {
    const s = errorStats([
      { predicted: 7, actual: 8 },
      { predicted: 7, actual: 6 },
      { predicted: 9, actual: 9 },
    ])
    expect(s.count).toBe(3)
    expect(s.mae).toBeCloseTo(2 / 3, 6)
    expect(s.rmse).toBeCloseTo(Math.sqrt(2 / 3), 6)
  })
  it("lista vazia → nulls", () => {
    expect(errorStats([])).toEqual({ count: 0, mae: null, rmse: null })
  })
})

describe("computeProspectiveSummary", () => {
  it("MAE, RMSE, erro com sinal e mediana do |erro|", () => {
    const r = computeProspectiveSummary([
      snap({ actual: 8, predictedScore: 7 }), // +1
      snap({ actual: 6, predictedScore: 7 }), // -1
      snap({ actual: 9, predictedScore: 9 }), // 0
    ])
    expect(r.count).toBe(3)
    expect(r.mae).toBeCloseTo(2 / 3, 6)
    expect(r.rmse).toBeCloseTo(Math.sqrt(2 / 3), 6)
    expect(r.meanSignedError).toBeCloseTo(0, 6)
    expect(r.medianAbsError).toBe(1)
  })
  it("ignora snapshots sem previsão", () => {
    const r = computeProspectiveSummary([snap({ actual: 8 }), snap({ actual: 7, predictedScore: 7 })])
    expect(r.count).toBe(1)
    expect(r.mae).toBe(0)
  })
})

describe("selectPrimaryPredictionPerWork", () => {
  it("uma obra com um snapshot → ele mesmo", () => {
    const out = selectPrimaryPredictionPerWork([snap({ workId: "a", actual: 8, predictedScore: 7 })])
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(7)
  })

  it("três snapshots antes da avaliação → escolhe o mais recente anterior", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 6, capturedAt: "2026-06-01T00:00:00Z", resolvedAt: "2026-06-17T00:00:00Z" }),
      snap({ workId: "a", actual: 8, predictedScore: 6.5, capturedAt: "2026-06-05T00:00:00Z", resolvedAt: "2026-06-17T00:00:00Z" }),
      snap({ workId: "a", actual: 8, predictedScore: 7, capturedAt: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-17T00:00:00Z" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(7) // capturedAt mais recente (10/06)
  })

  it("snapshot criado DEPOIS da avaliação não é escolhido", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 7, capturedAt: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-12T00:00:00Z" }),
      // capturado depois da 1ª avaliação (12/06) — não é previsão prospectiva dela
      snap({ workId: "a", actual: 8, predictedScore: 2, capturedAt: "2026-06-15T00:00:00Z", resolvedAt: "2026-06-16T00:00:00Z" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(7)
  })

  it("snapshot superseded é ignorado", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 7, capturedAt: "2026-06-10T00:00:00Z", superseded: true }),
      snap({ workId: "a", actual: 8, predictedScore: 6, capturedAt: "2026-06-09T00:00:00Z", superseded: false }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(6)
  })

  it("snapshot stub é ignorado (fallback não é previsão real)", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 7.8, capturedAt: "2026-06-10T00:00:00Z", predictedIsStub: true }),
      snap({ workId: "a", actual: 8, predictedScore: 6, capturedAt: "2026-06-09T00:00:00Z", predictedIsStub: false }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(6)
  })

  it("obra só com snapshots stub não entra", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 7.8, predictedIsStub: true }),
    ])
    expect(out).toHaveLength(0)
  })

  it("duas obras com quantidades diferentes → uma previsão por obra", () => {
    const out = selectPrimaryPredictionPerWork([
      snap({ workId: "a", actual: 8, predictedScore: 7, capturedAt: "2026-06-10T00:00:00Z" }),
      snap({ workId: "a", actual: 8, predictedScore: 6, capturedAt: "2026-06-05T00:00:00Z" }),
      snap({ workId: "b", actual: 5, predictedScore: 5, capturedAt: "2026-06-01T00:00:00Z" }),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.workId).sort()).toEqual(["a", "b"])
  })
})

describe("selectPrimaryPredictionPerWorkAndFormula", () => {
  it("mantém uma observação por obra POR fórmula (v1 não perde o exemplo)", () => {
    // obra 'a' prevista por v1 (06/05) e v2 (10/06) ANTES da avaliação (17/06).
    const all: ResolvedSnapshot[] = [
      snap({ workId: "a", actual: 8, predictedScore: 6, formulaVersion: "v1", capturedAt: "2026-06-05T00:00:00Z", resolvedAt: "2026-06-17T00:00:00Z" }),
      snap({ workId: "a", actual: 8, predictedScore: 7.5, formulaVersion: "v2", capturedAt: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-17T00:00:00Z" }),
    ]
    // por obra global: só a mais recente (v2)
    expect(selectPrimaryPredictionPerWork(all)).toHaveLength(1)
    // por obra×fórmula: as duas (v1 e v2)
    const perFormula = selectPrimaryPredictionPerWorkAndFormula(all)
    expect(perFormula).toHaveLength(2)
    const byFormula = new Map(perFormula.map((s) => [s.formulaVersion, s.predictedScore]))
    expect(byFormula.get("v1")).toBe(6)
    expect(byFormula.get("v2")).toBe(7.5)
  })

  it("dentro da MESMA fórmula deduplica pra a mais recente pré-avaliação", () => {
    const all: ResolvedSnapshot[] = [
      snap({ workId: "a", actual: 8, predictedScore: 6, formulaVersion: "v1", capturedAt: "2026-06-05T00:00:00Z" }),
      snap({ workId: "a", actual: 8, predictedScore: 6.5, formulaVersion: "v1", capturedAt: "2026-06-09T00:00:00Z" }),
    ]
    const out = selectPrimaryPredictionPerWorkAndFormula(all)
    expect(out).toHaveLength(1)
    expect(out[0].predictedScore).toBe(6.5)
  })
})

describe("MAE por obra ≠ MAE por snapshot (pseudorreplicação)", () => {
  // obra 'a' vista 3× (previsão ruim), obra 'b' 1× (previsão boa).
  const all: ResolvedSnapshot[] = [
    snap({ workId: "a", actual: 10, predictedScore: 4, capturedAt: "2026-06-03T00:00:00Z" }),
    snap({ workId: "a", actual: 10, predictedScore: 4, capturedAt: "2026-06-05T00:00:00Z" }),
    snap({ workId: "a", actual: 10, predictedScore: 4, capturedAt: "2026-06-10T00:00:00Z" }),
    snap({ workId: "b", actual: 8, predictedScore: 8, capturedAt: "2026-06-01T00:00:00Z" }),
  ]
  it("por snapshot pesa a obra repetida 3×", () => {
    const perSnap = computeProspectiveSummary(all)
    expect(perSnap.count).toBe(4)
    expect(perSnap.mae).toBeCloseTo((6 + 6 + 6 + 0) / 4, 6) // 4.5
  })
  it("por obra conta cada obra uma vez", () => {
    const primary = computeProspectiveSummary(selectPrimaryPredictionPerWork(all))
    expect(primary.count).toBe(2)
    expect(primary.mae).toBeCloseTo((6 + 0) / 2, 6) // 3.0
  })
})

describe("agrupamentos de erro", () => {
  it("por faixa de nota prevista", () => {
    const bands = computeErrorByScoreBand([
      snap({ actual: 6, predictedScore: 6.5 }),
      snap({ actual: 9, predictedScore: 9.2 }),
    ])
    expect(bands.find((b) => b.label === "6–7")?.count).toBe(1)
    expect(bands.find((b) => b.label === "≥ 9")?.count).toBe(1)
  })
  it("por versão da fórmula", () => {
    const rows = computeErrorByFormula([
      snap({ actual: 8, predictedScore: 7, formulaVersion: "v8" }),
      snap({ actual: 9, predictedScore: 9, formulaVersion: "v9" }),
    ])
    expect(rows.map((r) => r.label)).toEqual(["v8", "v9"])
    expect(rows.find((r) => r.label === "v9")?.mae).toBe(0)
  })
  it("por período (mês de resolução)", () => {
    const rows = computeErrorByPeriod(
      [
        snap({ actual: 8, predictedScore: 7, resolvedAt: "2026-05-10T00:00:00Z" }),
        snap({ actual: 9, predictedScore: 9, resolvedAt: "2026-06-10T00:00:00Z" }),
      ],
      "month",
    )
    expect(rows.map((r) => r.label)).toEqual(["2026-05", "2026-06"])
  })
})

describe("baselines", () => {
  const records = [
    snap({ actual: 8, predictedScore: 7, calcScore: 7.5, decisionScore: 7.2 }),
    snap({ actual: 6, predictedScore: 7, calcScore: 6.5, decisionScore: 6.8 }),
    snap({ actual: 9, predictedScore: 9, calcScore: 9, decisionScore: 9 }),
  ]
  it("baseline da média usa a média das notas reais", () => {
    const mean = computeBaselines(records).find((r) => r.key === "mean")
    const meanActual = (8 + 6 + 9) / 3
    const expectedMae = (Math.abs(8 - meanActual) + Math.abs(6 - meanActual) + Math.abs(9 - meanActual)) / 3
    expect(mean?.count).toBe(3)
    expect(mean?.mae).toBeCloseTo(expectedMae, 6)
  })
  it("reporta count por preditor (coberturas podem diferir)", () => {
    const partial = [...records, snap({ actual: 7, predictedScore: 7 })]
    const rows = computeBaselines(partial)
    expect(rows.find((r) => r.key === "expected")?.count).toBe(4)
    expect(rows.find((r) => r.key === "calc")?.count).toBe(3)
  })
  it("common subset só usa obras com expected+calc+decision", () => {
    const partial = [...records, snap({ actual: 7, predictedScore: 7 })]
    const cs = computeBaselinesOnCommonSubset(partial)
    expect(cs.subsetCount).toBe(3)
  })
})

describe("computeSnapshotStats (cobertura / viés de seleção)", () => {
  const row = (p: Partial<SnapshotStatsRow>): SnapshotStatsRow => ({
    workId: p.workId ?? "w1",
    rankingSnapshotId: p.rankingSnapshotId ?? null,
    resolvedAt: p.resolvedAt ?? null,
    superseded: p.superseded ?? false,
  })

  it("nenhuma previsão → zeros e taxas null (sem divisão por zero)", () => {
    const s = computeSnapshotStats([])
    expect(s.recorded).toBe(0)
    expect(s.resolutionRate).toBeNull()
    expect(s.resolutionRateByWork).toBeNull()
  })
  it("nenhuma resolvida → pending = recorded, taxa 0", () => {
    const s = computeSnapshotStats([row({ workId: "a" }), row({ workId: "b" })])
    expect(s.resolved).toBe(0)
    expect(s.pending).toBe(2)
    expect(s.resolutionRate).toBe(0)
    expect(s.resolutionRateByWork).toBe(0)
  })
  it("parte resolvida → taxas por snapshot e por obra", () => {
    const s = computeSnapshotStats([
      row({ workId: "a", resolvedAt: "2026-06-17T00:00:00Z", rankingSnapshotId: "r1" }),
      row({ workId: "a", rankingSnapshotId: "r2" }),
      row({ workId: "b", rankingSnapshotId: "r1" }),
      row({ workId: "c", resolvedAt: "2026-06-18T00:00:00Z", rankingSnapshotId: "r2" }),
    ])
    expect(s.recorded).toBe(4)
    expect(s.resolved).toBe(2)
    expect(s.resolutionRate).toBe(0.5)
    expect(s.uniqueWorksPredicted).toBe(3) // a,b,c
    expect(s.uniqueWorksEvaluated).toBe(2) // a,c
    expect(s.resolutionRateByWork).toBeCloseTo(2 / 3, 6)
    expect(s.rankingsRecorded).toBe(2) // r1,r2
  })
  it("superseded conta separado e não vira 'avaliada'", () => {
    const s = computeSnapshotStats([
      row({ workId: "a", resolvedAt: "2026-06-17T00:00:00Z", superseded: true }),
    ])
    expect(s.resolved).toBe(1)
    expect(s.superseded).toBe(1)
    expect(s.uniqueWorksEvaluated).toBe(0)
  })
})

describe("medianResolutionLatencyMs", () => {
  it("mediana do tempo captura→resolução", () => {
    const day = 86_400_000
    const out = medianResolutionLatencyMs([
      snap({ actual: 8, capturedAt: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-12T00:00:00Z" }), // 2d
      snap({ actual: 8, capturedAt: "2026-06-10T00:00:00Z", resolvedAt: "2026-06-14T00:00:00Z" }), // 4d
    ])
    expect(out).toBe(3 * day) // mediana de 2d e 4d
  })
  it("lista vazia → null", () => {
    expect(medianResolutionLatencyMs([])).toBeNull()
  })
})
