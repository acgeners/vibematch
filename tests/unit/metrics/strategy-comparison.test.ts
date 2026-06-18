import { describe, it, expect } from "vitest"
import {
  orderingValue,
  isUsable,
  bootstrapMeanCI,
  computeStrategyAggregates,
  comparePair,
  computeStrategyComparison,
  STRATEGY_COMPARISON_CONFIG,
  type StrategyResultRecord,
} from "@/lib/metrics/strategy-comparison"

function rec(p: Partial<StrategyResultRecord> & {
  predictionSnapshotId: string
  rankingSnapshotId: string
  strategyKey: string
}): StrategyResultRecord {
  return {
    strategyVersion: "v1",
    rankPosition: null,
    strategyScore: null,
    eligible: true,
    isDisplayedStrategy: false,
    actual: null,
    resolvedAt: null,
    superseded: false,
    predictedIsStub: false,
    ...p,
  }
}

/** N works num run, com score e actual; resolvido por default. */
function runRecords(
  runId: string,
  strategyKey: string,
  works: Array<{ score: number; actual: number }>,
  opts: Partial<Pick<StrategyResultRecord, "eligible" | "predictedIsStub" | "superseded" | "isDisplayedStrategy">> = {},
  resolved = true,
): StrategyResultRecord[] {
  return works.map((w, i) =>
    rec({
      predictionSnapshotId: `${runId}-w${i}`,
      rankingSnapshotId: runId,
      strategyKey,
      strategyScore: w.score,
      actual: w.actual,
      resolvedAt: resolved ? "2026-06-17T00:00:00Z" : null,
      ...opts,
    }),
  )
}

/** Ground-truth de candidatos por run pra testes: snapshots distintos por run. */
function expectedFromRecords(records: StrategyResultRecord[]): Map<string, number> {
  const byRun = new Map<string, Set<string>>()
  for (const r of records) {
    const s = byRun.get(r.rankingSnapshotId) ?? new Set<string>()
    s.add(r.predictionSnapshotId)
    byRun.set(r.rankingSnapshotId, s)
  }
  return new Map([...byRun].map(([k, v]) => [k, v.size]))
}

const FIVE = [
  { actual: 1 },
  { actual: 2 },
  { actual: 3 },
  { actual: 4 },
  { actual: 5 },
]
const perfect = FIVE.map((w) => ({ score: w.actual, actual: w.actual }))
const reversed = FIVE.map((w) => ({ score: -w.actual, actual: w.actual }))

describe("orderingValue", () => {
  it("usa o escalar quando há", () => {
    expect(orderingValue({ strategyScore: 7.5, rankPosition: 3 })).toBe(7.5)
  })
  it("usa -rankPosition quando não há escalar", () => {
    expect(orderingValue({ strategyScore: null, rankPosition: 2 })).toBe(-2)
  })
  it("null quando não há nenhum", () => {
    expect(orderingValue({ strategyScore: null, rankPosition: null })).toBeNull()
  })
})

describe("isUsable — ausência ≠ zero, exclui stub/superseded", () => {
  const base = rec({ predictionSnapshotId: "p", rankingSnapshotId: "r", strategyKey: "calc_score", strategyScore: 7, actual: 8, resolvedAt: "2026-06-17T00:00:00Z" })
  it("usável quando elegível, resolvido, não-stub, não-superseded, com ordem", () => {
    expect(isUsable(base)).toBe(true)
  })
  it("não usável sem nota (não vira zero)", () => {
    expect(isUsable({ ...base, actual: null, resolvedAt: null })).toBe(false)
  })
  it("não usável se inelegível, stub ou superseded", () => {
    expect(isUsable({ ...base, eligible: false })).toBe(false)
    expect(isUsable({ ...base, predictedIsStub: true })).toBe(false)
    expect(isUsable({ ...base, superseded: true })).toBe(false)
  })
})

describe("bootstrapMeanCI — reamostra runs (não pares)", () => {
  it("null abaixo do mínimo de runs", () => {
    expect(bootstrapMeanCI([0.1, 0.2, 0.3])).toBeNull()
  })
  it("série constante → IC degenerado no valor", () => {
    const ci = bootstrapMeanCI(new Array(12).fill(0.5))
    expect(ci).not.toBeNull()
    expect(ci![0]).toBeCloseTo(0.5, 6)
    expect(ci![1]).toBeCloseTo(0.5, 6)
  })
  it("determinístico (mesma entrada → mesmo IC)", () => {
    const xs = Array.from({ length: 15 }, (_, i) => i / 15)
    expect(bootstrapMeanCI(xs)).toEqual(bootstrapMeanCI(xs))
  })
})

describe("computeStrategyAggregates", () => {
  const aggOf = (recs: StrategyResultRecord[], expected = expectedFromRecords(recs)) =>
    computeStrategyAggregates(recs, expected)

  it("run com < minResolvedPerRun obras usáveis NÃO entra nas métricas", () => {
    const small = runRecords("r1", "calc_score", perfect.slice(0, 4))
    const agg = aggOf(small).find((a) => a.key === "calc_score")!
    expect(agg.runsRecorded).toBe(1)
    expect(agg.runsUsable).toBe(0)
    expect(agg.metrics).toBeNull()
  })

  it("run com ≥ mínimo entra; cobertura reflete elegibilidade", () => {
    const recs = [
      ...runRecords("r1", "alignment_score", perfect),
      // mais uma obra inelegível (sem alignment) no mesmo run
      rec({ predictionSnapshotId: "r1-w5", rankingSnapshotId: "r1", strategyKey: "alignment_score", eligible: false, actual: 6, resolvedAt: "2026-06-17T00:00:00Z" }),
    ]
    const agg = aggOf(recs).find((a) => a.key === "alignment_score")!
    expect(agg.runsUsable).toBe(1)
    expect(agg.metrics).not.toBeNull()
    expect(agg.metrics!.spearman).toBeCloseTo(1, 6) // ordem perfeita
    // 6 linhas, 5 elegíveis → cobertura 5/6
    expect(agg.coverage).toBeCloseTo(5 / 6, 6)
  })

  it("não mistura runs: dois runs de 3 usáveis cada NÃO viram um de 6", () => {
    const recs = [
      ...runRecords("r1", "calc_score", perfect.slice(0, 3)),
      ...runRecords("r2", "calc_score", perfect.slice(0, 3)),
    ]
    const agg = aggOf(recs).find((a) => a.key === "calc_score")!
    expect(agg.runsUsable).toBe(0) // cada run tem só 3 (< 5)
  })

  it("stub/superseded ficam fora das obras resolvidas", () => {
    const recs = runRecords("r1", "calc_score", perfect, { predictedIsStub: true })
    const agg = aggOf(recs).find((a) => a.key === "calc_score")!
    expect(agg.resolvedWorks).toBe(0)
    expect(agg.runsUsable).toBe(0)
  })

  it("estratégias do registry sem captura aparecem como placeholders (captured=false)", () => {
    const recs = runRecords("r1", "calc_score", perfect)
    const aggs = aggOf(recs)
    // todas as 7 estratégias do registry aparecem
    expect(aggs.length).toBe(7)
    const mood = aggs.find((a) => a.key === "mood_within_tier")!
    expect(mood.captured).toBe(false)
    expect(mood.runsRecorded).toBe(0)
    expect(mood.metrics).toBeNull()
    // a que tem dados está marcada como capturada
    expect(aggs.find((a) => a.key === "calc_score")!.captured).toBe(true)
  })

  it("run COMPLETO: linhas = nº de snapshots esperados do run", () => {
    const recs = runRecords("r1", "calc_score", perfect) // 5 linhas
    const agg = computeStrategyAggregates(recs, new Map([["r1", 5]])).find((a) => a.key === "calc_score")!
    expect(agg.runsComplete).toBe(1)
    expect(agg.runsPartial).toBe(0)
  })

  it("run INCOMPLETO: total esperado vem dos snapshots, NÃO das linhas gravadas", () => {
    // 15 linhas gravadas, mas o run tinha 20 snapshots → incompleto (não mascara).
    const recs = runRecords("r1", "calc_score", Array.from({ length: 15 }, (_, i) => ({ score: i, actual: i })))
    const agg = computeStrategyAggregates(recs, new Map([["r1", 20]])).find((a) => a.key === "calc_score")!
    expect(agg.runsComplete).toBe(0)
    expect(agg.runsPartial).toBe(1)
  })

  it("displayed_current parcial NÃO rebaixa o esperado das outras estratégias", () => {
    // displayed_current gravou só 15 (falha parcial); calc_score gravou 15;
    // mas o run tinha 20 snapshots → AMBAS incompletas.
    const works15 = Array.from({ length: 15 }, (_, i) => ({ score: i, actual: i }))
    const recs = [
      ...runRecords("r1", "displayed_current", works15, { isDisplayedStrategy: true }),
      ...runRecords("r1", "calc_score", works15),
    ]
    const aggs = computeStrategyAggregates(recs, new Map([["r1", 20]]))
    expect(aggs.find((a) => a.key === "displayed_current")!.runsComplete).toBe(0)
    expect(aggs.find((a) => a.key === "calc_score")!.runsComplete).toBe(0)
  })
})

describe("comparePair — subconjunto comum, sem misturar runs", () => {
  it("só compara obras elegíveis+resolvidas em AMBAS", () => {
    // A elegível em 5; B elegível só em 3 → comum 3 < 5 → run excluído
    const a = runRecords("r1", "expected_score", perfect)
    const bWorks = perfect.map((w, i) => ({ ...w, eligible: i < 3 }))
    const b = bWorks.map((w, i) =>
      rec({
        predictionSnapshotId: `r1-w${i}`,
        rankingSnapshotId: "r1",
        strategyKey: "calc_score",
        strategyScore: w.score,
        actual: w.actual,
        resolvedAt: "2026-06-17T00:00:00Z",
        eligible: w.eligible,
      }),
    )
    const cmp = comparePair([...a, ...b], { key: "expected_score", version: "v1" }, { key: "calc_score", version: "v1" })
    expect(cmp.runsCompared).toBe(0)
    expect(cmp.verdict).toBe("insufficient")
  })

  it("não mistura rankings: 2 runs de 3 comuns → 0 comparados", () => {
    const recs = [
      ...runRecords("r1", "expected_score", perfect.slice(0, 3)),
      ...runRecords("r1", "calc_score", perfect.slice(0, 3)),
      ...runRecords("r2", "expected_score", perfect.slice(0, 3)),
      ...runRecords("r2", "calc_score", perfect.slice(0, 3)),
    ]
    const cmp = comparePair(recs, { key: "expected_score", version: "v1" }, { key: "calc_score", version: "v1" })
    expect(cmp.runsCompared).toBe(0)
  })

  it("10 runs com A perfeito × B invertido → possível melhora (IC exclui 0)", () => {
    const recs: StrategyResultRecord[] = []
    for (let r = 0; r < 10; r++) {
      recs.push(...runRecords(`run${r}`, "expected_score", perfect))
      recs.push(...runRecords(`run${r}`, "calc_score", reversed))
    }
    const cmp = comparePair(recs, { key: "expected_score", version: "v1" }, { key: "calc_score", version: "v1" })
    expect(cmp.runsCompared).toBe(10)
    expect(cmp.verdict).toBe("possible_improvement")
    const pw = cmp.diffs.find((d) => d.metric === "pairwiseAccuracy")!
    expect(pw.diff).toBeCloseTo(1, 6) // A pairwise 1, B 0
    expect(pw.ci![0]).toBeGreaterThan(0)
  })

  it("estratégias idênticas em 10 runs → equivalente (IC inclui 0)", () => {
    const recs: StrategyResultRecord[] = []
    for (let r = 0; r < 10; r++) {
      recs.push(...runRecords(`run${r}`, "expected_score", perfect))
      recs.push(...runRecords(`run${r}`, "calc_score", perfect))
    }
    const cmp = comparePair(recs, { key: "expected_score", version: "v1" }, { key: "calc_score", version: "v1" })
    expect(cmp.verdict).toBe("equivalent")
  })

  it("menos de minRunsForSummary runs comparáveis → insuficiente", () => {
    const recs: StrategyResultRecord[] = []
    for (let r = 0; r < 3; r++) {
      recs.push(...runRecords(`run${r}`, "expected_score", perfect))
      recs.push(...runRecords(`run${r}`, "calc_score", reversed))
    }
    const cmp = comparePair(recs, { key: "expected_score", version: "v1" }, { key: "calc_score", version: "v1" })
    expect(cmp.runsCompared).toBe(3)
    expect(cmp.verdict).toBe("insufficient")
  })
})

describe("computeStrategyComparison", () => {
  it("monta as comparações prioritárias e totais", () => {
    const recs = [
      ...runRecords("r1", "displayed_current", perfect, { isDisplayedStrategy: true }),
      ...runRecords("r1", "calc_score", perfect),
    ]
    const report = computeStrategyComparison(recs, expectedFromRecords(recs))
    expect(report.totalRuns).toBe(1)
    expect(report.pairwise.length).toBe(6) // PRIORITY_COMPARISONS
    expect(report.totalResolvedSnapshots).toBe(5)
    // todas as estratégias do registry aparecem; a exibida vem primeiro
    expect(report.strategies.length).toBe(7)
    expect(report.strategies[0].isDisplayed).toBe(true)
    expect(report.strategies.find((s) => s.key === "mood_within_tier")!.captured).toBe(false)
  })

  it("config mínima é a referência provisória centralizada", () => {
    expect(STRATEGY_COMPARISON_CONFIG.minResolvedPerRun).toBe(5)
    expect(STRATEGY_COMPARISON_CONFIG.minRunsForSummary).toBe(10)
  })
})
