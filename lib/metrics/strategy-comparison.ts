/**
 * Comparação PROSPECTIVA de estratégias de ranking (shadow mode / AUDIT_REPORT P1).
 *
 * Funções PURAS. Recebem os registros individuais já resolvidos
 * (ranking_strategy_snapshots ⋈ prediction_snapshots) e devolvem, por estratégia,
 * métricas de ordenação agregadas POR RUN (nunca misturando obras de runs
 * diferentes), e comparações PAREADAS no SUBCONJUNTO COMUM.
 *
 * Princípios (do plano):
 *  - métricas de ranking só DENTRO de um mesmo ranking_snapshot_id;
 *  - ausência ≠ zero: inelegível/sem nota/stub/superseded são EXCLUÍDOS, não viram 0;
 *  - comparação A×B usa só obras elegíveis+resolvidas em AMBAS;
 *  - bootstrap reamostra RUNS (ranking_snapshot_id), não pares individuais;
 *  - nada de "vencedor" antes dos mínimos de amostra (verdict "insufficient").
 */

import { computeRankingMetrics, type RankedPair, type RankingMetrics } from "./ranking-metrics"
import {
  RANKING_STRATEGIES,
  type RankingStrategyKey,
  type RankingStrategyDefinition,
} from "@/lib/ranking/strategies/registry"

/** Limites mínimos (provisórios) — centralizados aqui (plano §10). */
export const STRATEGY_COMPARISON_CONFIG = {
  /** Mínimo de obras resolvidas num run pra calcular métricas de ranking. */
  minResolvedPerRun: 5,
  /** Mínimo de runs elegíveis pra mostrar resumo agregado / emitir veredito. */
  minRunsForSummary: 10,
  /** Mínimo de obras únicas resolvidas pra destacar uma estratégia. */
  minUniqueResolvedToHighlight: 30,
  /** Iterações do bootstrap (reamostragem por run). */
  bootstrapIterations: 2000,
} as const

/** Registro carregado do banco (uma obra × estratégia × versão, com resolução). */
export interface StrategyResultRecord {
  predictionSnapshotId: string
  rankingSnapshotId: string
  strategyKey: string
  strategyVersion: string
  rankPosition: number | null
  strategyScore: number | null
  eligible: boolean
  isDisplayedStrategy: boolean
  // ── resolução (do prediction_snapshot) ──
  actual: number | null
  resolvedAt: string | null
  superseded: boolean
  predictedIsStub: boolean
}

/**
 * Valor de ORDENAÇÃO (maior = melhor). Usa o escalar quando há; senão a posição
 * exibida invertida (rank 1 = topo → maior valor). Null quando nenhum dos dois.
 */
export function orderingValue(r: Pick<StrategyResultRecord, "strategyScore" | "rankPosition">): number | null {
  if (r.strategyScore != null && Number.isFinite(r.strategyScore)) return r.strategyScore
  if (r.rankPosition != null && Number.isFinite(r.rankPosition)) return -r.rankPosition
  return null
}

/** Usável pra métricas: elegível, resolvido, não-stub, não-superseded, com ordem. */
export function isUsable(r: StrategyResultRecord): boolean {
  return (
    r.eligible &&
    !r.superseded &&
    !r.predictedIsStub &&
    r.resolvedAt != null &&
    r.actual != null &&
    orderingValue(r) != null
  )
}

function keyVersion(r: { strategyKey: string; strategyVersion: string }): string {
  return `${r.strategyKey}::${r.strategyVersion}`
}

function labelFor(key: string): string {
  return RANKING_STRATEGIES[key as RankingStrategyKey]?.label ?? key
}

function experimentalFor(key: string): boolean {
  return RANKING_STRATEGIES[key as RankingStrategyKey]?.experimental ?? true
}

// ── PRNG determinístico (mulberry32) pra bootstrap reproduzível ──────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * IC95% (percentil 2.5/97.5) da MÉDIA de uma série, por bootstrap reamostrando
 * os elementos (= runs) com reposição. Determinístico (seed fixo). null quando
 * há menos de minRunsForSummary observações.
 */
export function bootstrapMeanCI(
  perRun: number[],
  iterations = STRATEGY_COMPARISON_CONFIG.bootstrapIterations,
  seed = 1234567,
): [number, number] | null {
  const vals = perRun.filter((v) => Number.isFinite(v))
  if (vals.length < STRATEGY_COMPARISON_CONFIG.minRunsForSummary) return null
  const rng = mulberry32(seed)
  const means: number[] = []
  for (let it = 0; it < iterations; it++) {
    let sum = 0
    for (let i = 0; i < vals.length; i++) {
      const j = Math.floor(rng() * vals.length)
      sum += vals[j]
    }
    means.push(sum / vals.length)
  }
  means.sort((a, b) => a - b)
  return [percentile(means, 0.025), percentile(means, 0.975)]
}

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x))
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length
}

/** Média de cada métrica de ranking entre runs (ignora nulls por métrica). */
function meanRankingMetrics(groups: RankingMetrics[]): RankingMetrics | null {
  if (groups.length === 0) return null
  const avg = (sel: (m: RankingMetrics) => number | null) =>
    mean(groups.map(sel).filter((v): v is number => v != null))
  return {
    count: groups.reduce((a, g) => a + g.count, 0),
    spearman: avg((m) => m.spearman),
    kendallTau: avg((m) => m.kendallTau),
    pairwiseAccuracy: avg((m) => m.pairwiseAccuracy),
    ndcgAt5: avg((m) => m.ndcgAt5),
    ndcgAt10: avg((m) => m.ndcgAt10),
    precisionAt5: avg((m) => m.precisionAt5),
    precisionAt10: avg((m) => m.precisionAt10),
    regretAt5: avg((m) => m.regretAt5),
    regretAt10: avg((m) => m.regretAt10),
  }
}

function toPairs(records: StrategyResultRecord[]): RankedPair[] {
  return records.map((r) => ({ predicted: orderingValue(r) as number, actual: r.actual as number }))
}

// ── Agregado por estratégia ──────────────────────────────────────────────────

export interface StrategyAggregate {
  key: string
  version: string
  label: string
  experimental: boolean
  isDisplayed: boolean
  /** false = estratégia do registry SEM nenhum snapshot capturado (ex.: mood sem fluxo). */
  captured: boolean
  /** Runs distintos em que a estratégia aparece. */
  runsRecorded: number
  /**
   * Runs em que a estratégia tem uma linha pra TODA obra prospectiva do run. O
   * total esperado vem da fonte ANTERIOR à captura (nº de prediction_snapshots
   * do run), NÃO da contagem de linhas da própria estratégia — senão uma falha
   * parcial de persistência rebaixaria o esperado e mascararia o incompleto.
   */
  runsComplete: number
  runsPartial: number
  /** Runs com ≥ minResolvedPerRun obras usáveis (entram nas métricas). */
  runsUsable: number
  /** Linhas totais / elegíveis da estratégia (cobertura por linha). */
  totalRows: number
  eligibleRows: number
  /** Obras únicas elegíveis / resolvidas-usáveis. */
  resolvedWorks: number
  coverage: number | null
  /** Métricas de ordenação, média entre os runs usáveis. null sem amostra. */
  metrics: RankingMetrics | null
  /** runsUsable ≥ minRunsForSummary. */
  enoughData: boolean
}

/** Placeholder de uma estratégia do registry ainda SEM captura (ex.: mood sem fluxo). */
function emptyAggregate(def: RankingStrategyDefinition): StrategyAggregate {
  return {
    key: def.key,
    version: def.version,
    label: def.label,
    experimental: def.experimental,
    isDisplayed: def.key === "displayed_current",
    captured: false,
    runsRecorded: 0,
    runsComplete: 0,
    runsPartial: 0,
    runsUsable: 0,
    totalRows: 0,
    eligibleRows: 0,
    resolvedWorks: 0,
    coverage: null,
    metrics: null,
    enoughData: false,
  }
}

/** Agrega UMA estratégia (key×version) a partir das suas linhas. */
function aggregateOne(
  rows: StrategyResultRecord[],
  expectedByRun: ReadonlyMap<string, number>,
): StrategyAggregate {
  const first = rows[0]
  const byRun = new Map<string, StrategyResultRecord[]>()
  for (const r of rows) {
    const arr = byRun.get(r.rankingSnapshotId) ?? []
    arr.push(r)
    byRun.set(r.rankingSnapshotId, arr)
  }

  let runsComplete = 0
  const usableGroups: RankingMetrics[] = []
  const resolvedWorkIds = new Set<string>()
  for (const [runId, runRows] of byRun) {
    // Total esperado = nº de prediction_snapshots do run (fonte anterior à
    // captura das estratégias). Se a run não consta no mapa, NÃO declaramos
    // completa (conservador) — nunca usamos a contagem da própria estratégia.
    const expected = expectedByRun.get(runId)
    if (expected != null && runRows.length >= expected) runsComplete += 1

    const usable = runRows.filter(isUsable)
    for (const u of usable) resolvedWorkIds.add(u.predictionSnapshotId)
    if (usable.length >= STRATEGY_COMPARISON_CONFIG.minResolvedPerRun) {
      usableGroups.push(computeRankingMetrics(toPairs(usable)))
    }
  }

  const totalRows = rows.length
  const eligibleRows = rows.filter((r) => r.eligible).length

  return {
    key: first.strategyKey,
    version: first.strategyVersion,
    label: labelFor(first.strategyKey),
    experimental: experimentalFor(first.strategyKey),
    isDisplayed: first.isDisplayedStrategy,
    captured: true,
    runsRecorded: byRun.size,
    runsComplete,
    runsPartial: byRun.size - runsComplete,
    runsUsable: usableGroups.length,
    totalRows,
    eligibleRows,
    resolvedWorks: resolvedWorkIds.size,
    coverage: totalRows > 0 ? eligibleRows / totalRows : null,
    metrics: meanRankingMetrics(usableGroups),
    enoughData: usableGroups.length >= STRATEGY_COMPARISON_CONFIG.minRunsForSummary,
  }
}

/**
 * Agrega por estratégia. `expectedByRun` = nº de prediction_snapshots por run
 * (fonte anterior à captura — ver runsComplete). Estratégias do registry SEM
 * registro entram como placeholders (captured=false) pra ficarem VISÍVEIS no
 * painel (ex.: mood_within_tier quando nenhum fluxo com mood é capturado).
 */
export function computeStrategyAggregates(
  records: StrategyResultRecord[],
  expectedByRun: ReadonlyMap<string, number>,
): StrategyAggregate[] {
  const byStrategy = new Map<string, StrategyResultRecord[]>()
  for (const r of records) {
    const k = keyVersion(r)
    const arr = byStrategy.get(k) ?? []
    arr.push(r)
    byStrategy.set(k, arr)
  }

  const out: StrategyAggregate[] = []
  const seen = new Set<string>()
  for (const [k, rows] of byStrategy) {
    out.push(aggregateOne(rows, expectedByRun))
    seen.add(k)
  }
  // Placeholders pras estratégias do registry (v1) sem nenhum registro.
  for (const key of Object.keys(RANKING_STRATEGIES) as RankingStrategyKey[]) {
    const def = RANKING_STRATEGIES[key]
    if (seen.has(`${def.key}::${def.version}`)) continue
    out.push(emptyAggregate(def))
  }

  // Ordem estável: estratégia exibida primeiro, depois pela ordem do registro.
  const order = Object.keys(RANKING_STRATEGIES)
  out.sort((a, b) => {
    if (a.isDisplayed !== b.isDisplayed) return a.isDisplayed ? -1 : 1
    return order.indexOf(a.key) - order.indexOf(b.key)
  })
  return out
}

// ── Comparação pareada no subconjunto comum ──────────────────────────────────

export type ComparisonVerdict = "insufficient" | "equivalent" | "possible_improvement" | "possible_worse"

export interface MetricDiff {
  metric: "pairwiseAccuracy" | "ndcgAt10"
  meanA: number | null
  meanB: number | null
  diff: number | null
  ci: [number, number] | null
}

export interface PairwiseComparison {
  aKey: string
  aLabel: string
  bKey: string
  bLabel: string
  version: string
  /** Runs com subconjunto comum ≥ minResolvedPerRun em AMBAS. */
  runsCompared: number
  /** Total de obras usáveis no subconjunto comum (soma entre runs). */
  worksCompared: number
  diffs: MetricDiff[]
  verdict: ComparisonVerdict
}

interface PerRunPaired {
  pairwiseA: number | null
  pairwiseB: number | null
  ndcgA: number | null
  ndcgB: number | null
}

/**
 * Compara duas estratégias no MESMO subconjunto de obras por run (elegíveis +
 * resolvidas em ambas). Reporta a diferença média (A − B) de pairwiseAccuracy e
 * NDCG@10 com IC95% bootstrap (reamostrando RUNS). Veredito por pairwiseAccuracy
 * (fallback NDCG@10): equivalente se o IC inclui 0; melhora/piora se o IC
 * exclui 0; insuficiente abaixo dos mínimos.
 */
export function comparePair(
  records: StrategyResultRecord[],
  a: { key: string; version: string },
  b: { key: string; version: string },
): PairwiseComparison {
  const isA = (r: StrategyResultRecord) => r.strategyKey === a.key && r.strategyVersion === a.version
  const isB = (r: StrategyResultRecord) => r.strategyKey === b.key && r.strategyVersion === b.version

  // Agrupa por run; dentro do run casa por prediction_snapshot_id (a obra).
  const byRun = new Map<string, { a: Map<string, StrategyResultRecord>; b: Map<string, StrategyResultRecord> }>()
  for (const r of records) {
    const isAR = isA(r)
    const isBR = isB(r)
    if (!isAR && !isBR) continue
    const entry = byRun.get(r.rankingSnapshotId) ?? { a: new Map(), b: new Map() }
    if (isAR) entry.a.set(r.predictionSnapshotId, r)
    if (isBR) entry.b.set(r.predictionSnapshotId, r)
    byRun.set(r.rankingSnapshotId, entry)
  }

  const perRun: PerRunPaired[] = []
  let worksCompared = 0
  for (const { a: aMap, b: bMap } of byRun.values()) {
    const aUsable: StrategyResultRecord[] = []
    const bUsable: StrategyResultRecord[] = []
    for (const [snapId, ra] of aMap) {
      const rb = bMap.get(snapId)
      if (!rb) continue
      if (!isUsable(ra) || !isUsable(rb)) continue
      aUsable.push(ra)
      bUsable.push(rb)
    }
    if (aUsable.length < STRATEGY_COMPARISON_CONFIG.minResolvedPerRun) continue
    worksCompared += aUsable.length
    const mA = computeRankingMetrics(toPairs(aUsable))
    const mB = computeRankingMetrics(toPairs(bUsable))
    perRun.push({
      pairwiseA: mA.pairwiseAccuracy,
      pairwiseB: mB.pairwiseAccuracy,
      ndcgA: mA.ndcgAt10,
      ndcgB: mB.ndcgAt10,
    })
  }

  const runsCompared = perRun.length

  const buildDiff = (
    metric: MetricDiff["metric"],
    selA: (p: PerRunPaired) => number | null,
    selB: (p: PerRunPaired) => number | null,
  ): MetricDiff => {
    const meanA = mean(perRun.map(selA).filter((v): v is number => v != null))
    const meanB = mean(perRun.map(selB).filter((v): v is number => v != null))
    const diffsPerRun = perRun
      .map((p) => {
        const va = selA(p)
        const vb = selB(p)
        return va != null && vb != null ? va - vb : null
      })
      .filter((v): v is number => v != null)
    const diff = mean(diffsPerRun)
    const ci = bootstrapMeanCI(diffsPerRun)
    return { metric, meanA, meanB, diff, ci }
  }

  const pairwiseDiff = buildDiff("pairwiseAccuracy", (p) => p.pairwiseA, (p) => p.pairwiseB)
  const ndcgDiff = buildDiff("ndcgAt10", (p) => p.ndcgA, (p) => p.ndcgB)

  // Veredito: usa pairwiseAccuracy (mais robusto); cai pra NDCG@10 se sem CI.
  const focus = pairwiseDiff.ci != null ? pairwiseDiff : ndcgDiff
  let verdict: ComparisonVerdict
  if (runsCompared < STRATEGY_COMPARISON_CONFIG.minRunsForSummary || focus.ci == null) {
    verdict = "insufficient"
  } else {
    const [lo, hi] = focus.ci
    if (lo <= 0 && hi >= 0) verdict = "equivalent"
    else if (lo > 0) verdict = "possible_improvement"
    else verdict = "possible_worse"
  }

  return {
    aKey: a.key,
    aLabel: labelFor(a.key),
    bKey: b.key,
    bLabel: labelFor(b.key),
    version: a.version,
    runsCompared,
    worksCompared,
    diffs: [pairwiseDiff, ndcgDiff],
    verdict,
  }
}

/** Pares de comparação prioritários (plano §12). A = candidata; B = referência. */
export const PRIORITY_COMPARISONS: Array<{ a: RankingStrategyKey; b: RankingStrategyKey }> = [
  { a: "expected_score", b: "calc_score" }, // Ridge × determinístico
  { a: "decision_score", b: "expected_score" }, // veredito IA × prevista
  { a: "decision_score", b: "calc_score" }, // veredito IA × calc
  { a: "displayed_current", b: "calc_score" }, // personalização exibida × base
  { a: "personal_fit", b: "calc_score" }, // afinidade × base
  { a: "mood_within_tier", b: "displayed_current" }, // mood × exibido
]

export interface StrategyComparisonReport {
  strategies: StrategyAggregate[]
  pairwise: PairwiseComparison[]
  totalRuns: number
  totalResolvedSnapshots: number
}

/**
 * Relatório completo a partir dos registros carregados. PURO. `expectedByRun` =
 * nº de prediction_snapshots por ranking_snapshot_id (fonte anterior à captura
 * das estratégias) — usado pra detectar runs incompletos sem mascarar falhas
 * parciais de persistência.
 */
export function computeStrategyComparison(
  records: StrategyResultRecord[],
  expectedByRun: ReadonlyMap<string, number>,
): StrategyComparisonReport {
  const strategies = computeStrategyAggregates(records, expectedByRun)
  const version = "v1"
  const pairwise = PRIORITY_COMPARISONS.map(({ a, b }) =>
    comparePair(records, { key: a, version }, { key: b, version }),
  )
  const runs = new Set(records.map((r) => r.rankingSnapshotId))
  const resolvedSnaps = new Set(records.filter(isUsable).map((r) => r.predictionSnapshotId))
  return {
    strategies,
    pairwise,
    totalRuns: runs.size,
    totalResolvedSnapshots: resolvedSnaps.size,
  }
}
