/**
 * Métricas PROSPECTIVAS sobre previsões resolvidas (prediction_snapshots / P1).
 *
 * Funções PURAS: recebem os registros individuais (a fonte de verdade — nunca
 * agregados pré-computados) e devolvem MAE/RMSE/erro com sinal/baselines por
 * recorte. Sem efeitos colaterais → testáveis e reusáveis no painel técnico.
 *
 * Convenção de erro: erro = actual - predicted (positivo = modelo subestimou).
 */

import { LABELS } from "@/lib/constants/ui-labels"

export interface ResolvedSnapshot {
  /** Obra a que o snapshot pertence (pra dedup por obra nas métricas globais). */
  workId: string
  /** ISO timestamp da captura da previsão (pré-rótulo). */
  capturedAt: string
  /** ISO timestamp da resolução (quando a nota real chegou). */
  resolvedAt: string
  /** Observação INVÁLIDA marcada manualmente — excluída das métricas. */
  superseded: boolean
  /** Previsão em fallback (média do treino, sem modelo real) — fora das métricas. */
  predictedIsStub: boolean
  /** Nota real do usuário (rótulo que chegou DEPOIS da previsão). */
  actual: number
  /** Nota Prevista (expected_score) no snapshot — preditor principal. 0–10. */
  predictedScore: number | null
  /** Nota.Calc no snapshot. 0–10. */
  calcScore: number | null
  /** Prioridade (decision_score) no snapshot. 0–10. */
  decisionScore: number | null
  formulaVersion: string
  trainingSampleSize: number | null
}

/**
 * Núcleo da seleção da previsão PRINCIPAL, agrupada por uma CHAVE arbitrária
 * (obra; ou obra×fórmula). Evita pseudorreplicação: cada chave entra 1×.
 *
 * Exclui sempre observações INVÁLIDAS (`superseded`) e previsões em FALLBACK
 * (`predictedIsStub` — média do treino, não é predição real). Para cada chave,
 * entre os snapshots elegíveis e RESOLVIDOS:
 *  1. "primeira avaliação real" = menor `resolvedAt` do grupo;
 *  2. só os capturados ATÉ essa avaliação (pré-rótulo) — criados DEPOIS não são
 *     previsão prospectiva dela;
 *  3. escolhe o MAIS RECENTE antes da avaliação (maior `capturedAt`; desempate
 *     determinístico por `resolvedAt`).
 *
 * PURA. Chaves sem snapshot elegível não entram.
 */
function selectPrimaryByKey(
  snapshots: readonly ResolvedSnapshot[],
  keyOf: (s: ResolvedSnapshot) => string,
): ResolvedSnapshot[] {
  const byKey = new Map<string, ResolvedSnapshot[]>()
  for (const s of snapshots) {
    if (s.superseded || s.predictedIsStub) continue
    const k = keyOf(s)
    const arr = byKey.get(k) ?? []
    arr.push(s)
    byKey.set(k, arr)
  }

  const out: ResolvedSnapshot[] = []
  for (const group of byKey.values()) {
    const firstEvalAt = group.reduce(
      (min, s) => (s.resolvedAt < min ? s.resolvedAt : min),
      group[0].resolvedAt,
    )
    const preLabel = group.filter((s) => s.capturedAt <= firstEvalAt)
    const pool = preLabel.length > 0 ? preLabel : group
    const primary = pool.reduce((best, s) => {
      if (s.capturedAt > best.capturedAt) return s
      if (s.capturedAt === best.capturedAt && s.resolvedAt < best.resolvedAt) return s
      return best
    }, pool[0])
    out.push(primary)
  }
  return out
}

/**
 * Uma previsão por OBRA — base das métricas GLOBAIS principais (reflete o estado
 * mais recente do modelo antes de cada obra ser avaliada).
 */
export function selectPrimaryPredictionPerWork(
  snapshots: readonly ResolvedSnapshot[],
): ResolvedSnapshot[] {
  return selectPrimaryByKey(snapshots, (s) => s.workId)
}

/**
 * Uma previsão por OBRA × VERSÃO DA FÓRMULA — base da comparação POR FÓRMULA.
 * Sem isto, uma obra prevista por v1 e v2 antes de ser avaliada só contaria pra
 * v2 (a v1 perderia o exemplo), inviabilizando comparação pareada no mesmo
 * conjunto de obras.
 */
export function selectPrimaryPredictionPerWorkAndFormula(
  snapshots: readonly ResolvedSnapshot[],
): ResolvedSnapshot[] {
  return selectPrimaryByKey(snapshots, (s) => `${s.workId}::${s.formulaVersion}`)
}

export interface ErrorStats {
  count: number
  mae: number | null
  rmse: number | null
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** MAE + RMSE de uma lista de pares (previsto, real). */
export function errorStats(pairs: Array<{ predicted: number; actual: number }>): ErrorStats {
  if (pairs.length === 0) return { count: 0, mae: null, rmse: null }
  let sumAbs = 0
  let sumSq = 0
  for (const { predicted, actual } of pairs) {
    const diff = actual - predicted
    sumAbs += Math.abs(diff)
    sumSq += diff * diff
  }
  return {
    count: pairs.length,
    mae: sumAbs / pairs.length,
    rmse: Math.sqrt(sumSq / pairs.length),
  }
}

export interface ProspectiveSummary extends ErrorStats {
  meanSignedError: number | null
  medianAbsError: number | null
}

/**
 * Resumo prospectivo do preditor principal (Nota Prevista / expected_score),
 * sobre os snapshots resolvidos que tinham previsão.
 */
export function computeProspectiveSummary(records: ResolvedSnapshot[]): ProspectiveSummary {
  const withPred = records.filter((r) => r.predictedScore != null)
  const pairs = withPred.map((r) => ({ predicted: r.predictedScore as number, actual: r.actual }))
  const base = errorStats(pairs)
  const signed = pairs.map((p) => p.actual - p.predicted)
  const abs = signed.map(Math.abs)
  return {
    ...base,
    meanSignedError: mean(signed),
    medianAbsError: median(abs),
  }
}

export interface BucketErrorEntry {
  label: string
  count: number
  mae: number | null
}

const SCORE_BANDS = [
  { label: "< 6", min: -Infinity, max: 6 },
  { label: "6–7", min: 6, max: 7 },
  { label: "7–8", min: 7, max: 8 },
  { label: "8–9", min: 8, max: 9 },
  { label: "≥ 9", min: 9, max: Infinity },
] as const

/** MAE por faixa da nota PREVISTA (onde o modelo erra mais). */
export function computeErrorByScoreBand(records: ResolvedSnapshot[]): BucketErrorEntry[] {
  return SCORE_BANDS.map((band) => {
    const pairs = records
      .filter(
        (r) => r.predictedScore != null && r.predictedScore >= band.min && r.predictedScore < band.max,
      )
      .map((r) => ({ predicted: r.predictedScore as number, actual: r.actual }))
    const { count, mae } = errorStats(pairs)
    return { label: band.label, count, mae }
  })
}

/** MAE agrupada por versão da fórmula (detecta regressão entre versões). */
export function computeErrorByFormula(records: ResolvedSnapshot[]): BucketErrorEntry[] {
  const groups = new Map<string, Array<{ predicted: number; actual: number }>>()
  for (const r of records) {
    if (r.predictedScore == null) continue
    const arr = groups.get(r.formulaVersion) ?? []
    arr.push({ predicted: r.predictedScore, actual: r.actual })
    groups.set(r.formulaVersion, arr)
  }
  return [...groups.entries()]
    .map(([version, pairs]) => {
      const { count, mae } = errorStats(pairs)
      return { label: version, count, mae }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** MAE agrupada por período de RESOLUÇÃO ('day' = YYYY-MM-DD, 'month' = YYYY-MM). */
export function computeErrorByPeriod(
  records: ResolvedSnapshot[],
  granularity: "day" | "month" = "month",
): BucketErrorEntry[] {
  const cut = granularity === "day" ? 10 : 7
  const groups = new Map<string, Array<{ predicted: number; actual: number }>>()
  for (const r of records) {
    if (r.predictedScore == null) continue
    const period = r.resolvedAt.slice(0, cut)
    const arr = groups.get(period) ?? []
    arr.push({ predicted: r.predictedScore, actual: r.actual })
    groups.set(period, arr)
  }
  return [...groups.entries()]
    .map(([period, pairs]) => {
      const { count, mae } = errorStats(pairs)
      return { label: period, count, mae }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export interface BaselineRow {
  key: "mean" | "expected" | "calc" | "decision"
  label: string
  count: number
  mae: number | null
  rmse: number | null
}

/** Helper: baseline "prever a média das notas reais do conjunto". */
function meanBaselineStats(actuals: number[]): ErrorStats {
  const m = mean(actuals)
  if (m == null) return { count: 0, mae: null, rmse: null }
  return errorStats(actuals.map((a) => ({ predicted: m, actual: a })))
}

/**
 * Baselines prospectivos, CADA UM sobre a sua própria cobertura (pode diferir).
 * O `count` por linha deixa explícito que os subconjuntos podem não coincidir —
 * pra comparação no MESMO subconjunto, ver computeBaselinesOnCommonSubset.
 */
export function computeBaselines(records: ResolvedSnapshot[]): BaselineRow[] {
  const all = records.map((r) => r.actual)
  const meanStats = meanBaselineStats(all)

  const pick = (sel: (r: ResolvedSnapshot) => number | null) =>
    errorStats(
      records
        .filter((r) => sel(r) != null)
        .map((r) => ({ predicted: sel(r) as number, actual: r.actual })),
    )

  const expected = pick((r) => r.predictedScore)
  const calc = pick((r) => r.calcScore)
  const decision = pick((r) => r.decisionScore)

  return [
    { key: "mean", label: "Baseline (média)", count: meanStats.count, mae: meanStats.mae, rmse: meanStats.rmse },
    { key: "expected", label: LABELS.expected_score.full, count: expected.count, mae: expected.mae, rmse: expected.rmse },
    { key: "calc", label: LABELS.calc_score.full, count: calc.count, mae: calc.mae, rmse: calc.rmse },
    { key: "decision", label: "Prioridade (decisão)", count: decision.count, mae: decision.mae, rmse: decision.rmse },
  ]
}

export interface CommonSubsetBaselines {
  subsetCount: number
  rows: BaselineRow[]
}

/**
 * Baselines comparados no MESMO subconjunto (obras com expected, calc e decision
 * todos presentes) — comparação honesta, sem misturar coberturas diferentes.
 */
export function computeBaselinesOnCommonSubset(records: ResolvedSnapshot[]): CommonSubsetBaselines {
  const subset = records.filter(
    (r) => r.predictedScore != null && r.calcScore != null && r.decisionScore != null,
  )
  const all = subset.map((r) => r.actual)
  const meanStats = meanBaselineStats(all)
  const stats = (sel: (r: ResolvedSnapshot) => number) =>
    errorStats(subset.map((r) => ({ predicted: sel(r), actual: r.actual })))

  const expected = stats((r) => r.predictedScore as number)
  const calc = stats((r) => r.calcScore as number)
  const decision = stats((r) => r.decisionScore as number)

  return {
    subsetCount: subset.length,
    rows: [
      { key: "mean", label: "Baseline (média)", count: meanStats.count, mae: meanStats.mae, rmse: meanStats.rmse },
      { key: "expected", label: LABELS.expected_score.full, count: expected.count, mae: expected.mae, rmse: expected.rmse },
      { key: "calc", label: LABELS.calc_score.full, count: calc.count, mae: calc.mae, rmse: calc.rmse },
      { key: "decision", label: "Prioridade (decisão)", count: decision.count, mae: decision.mae, rmse: decision.rmse },
    ],
  }
}

// ── Cobertura / taxa de resolução / viés de seleção ─────────────────────────

export interface SnapshotStatsRow {
  workId: string
  rankingSnapshotId: string | null
  resolvedAt: string | null
  superseded: boolean
}

export interface SnapshotStats {
  recorded: number
  resolved: number
  pending: number
  superseded: number
  /** resolved / recorded. null se não há snapshots. */
  resolutionRate: number | null
  uniqueWorksPredicted: number
  uniqueWorksEvaluated: number
  /** obras avaliadas / obras previstas. null se não há obras previstas. */
  resolutionRateByWork: number | null
  rankingsRecorded: number
}

/**
 * Cobertura da coleta. Deixa explícito o VIÉS DE SELEÇÃO: só obras que depois
 * recebem nota viram "resolvidas"; as ignoradas ficam pendentes (não são erro
 * nem zero). PURA — não divide por zero (retorna null).
 */
export function computeSnapshotStats(rows: readonly SnapshotStatsRow[]): SnapshotStats {
  const recorded = rows.length
  const resolvedRows = rows.filter((r) => r.resolvedAt != null)
  const evaluatedRows = resolvedRows.filter((r) => !r.superseded)
  const superseded = rows.filter((r) => r.superseded).length

  const worksPredicted = new Set(rows.map((r) => r.workId))
  const worksEvaluated = new Set(evaluatedRows.map((r) => r.workId))
  const rankings = new Set(
    rows.map((r) => r.rankingSnapshotId).filter((id): id is string => id != null),
  )

  return {
    recorded,
    resolved: resolvedRows.length,
    pending: recorded - resolvedRows.length,
    superseded,
    resolutionRate: recorded > 0 ? resolvedRows.length / recorded : null,
    uniqueWorksPredicted: worksPredicted.size,
    uniqueWorksEvaluated: worksEvaluated.size,
    resolutionRateByWork: worksPredicted.size > 0 ? worksEvaluated.size / worksPredicted.size : null,
    rankingsRecorded: rankings.size,
  }
}

/**
 * Tempo MEDIANO entre captura e resolução (ms), sobre os snapshots dados (ex.:
 * o conjunto principal por obra). null quando não há resolvidos com captura
 * anterior. PURA.
 */
export function medianResolutionLatencyMs(snapshots: readonly ResolvedSnapshot[]): number | null {
  const latencies: number[] = []
  for (const s of snapshots) {
    const captured = Date.parse(s.capturedAt)
    const resolved = Date.parse(s.resolvedAt)
    if (!Number.isFinite(captured) || !Number.isFinite(resolved)) continue
    const delta = resolved - captured
    if (delta >= 0) latencies.push(delta)
  }
  return median(latencies)
}
