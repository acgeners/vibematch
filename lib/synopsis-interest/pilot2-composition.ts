/**
 * Plano 3 — Planejamento PURO da composição do pilot-2 (Fase B2.2E). Sem banco, sem rede,
 * sem `server-only`, sem LLM. Calcula quotas/déficits/matriz split×stratum de forma
 * DETERMINÍSTICA a partir da composição dos carryovers (51 `unread` do pilot-1).
 *
 * NÃO recebe nem usa: label humano, valor de label contextual, saída de candidato, previsão,
 * score, ranking, alignment. As entradas são apenas split/stratum/contagens.
 *
 * NÃO seleciona obras, NÃO cria pilot-2. Só aritmética de planejamento (+ testes).
 */

export type Split = "development" | "holdout"
export const SPLITS: readonly Split[] = ["development", "holdout"]

/** Strata = nível de Interesse (♥..♥♥♥♥), ordem ordinal congelada. */
export const STRATA = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"] as const
export type Stratum = (typeof STRATA)[number]

export const PILOT2_TARGET_TOTAL = 90

export type SplitMap = Record<Split, number>
export type StratumMap = Record<Stratum, number>
export type Matrix = Record<Split, Record<Stratum, number>>

function emptyStratumMap(): StratumMap {
  return { "♥": 0, "♥♥": 0, "♥♥♥": 0, "♥♥♥♥": 0 }
}
function emptyMatrix(): Matrix {
  return { development: emptyStratumMap(), holdout: emptyStratumMap() }
}

// ── Composição dos carryovers (Parte C) ──────────────────────────────────────

export type ReviewContextKey = "digest_available" | "no_reviews_available"
export type TagContextKey = "tags_present" | "no_tags_legitimate" | "missing_recoverable_frozen_empty"

export interface CarryoverComposition {
  total: number
  bySplit: SplitMap
  byStratum: StratumMap
  matrix: Matrix
  reviewContext: Record<ReviewContextKey, number>
  tagContext: Record<TagContextKey, number>
}

/** Entrada por obra carryover — SÓ campos estruturais (nunca label/output de candidato). */
export interface CarryoverWork {
  split: Split
  stratum: Stratum
  reviewContext?: ReviewContextKey
  tagContextType?: TagContextKey
}

/**
 * Compõe os agregados dos carryovers. Determinístico e INDEPENDENTE DA ORDEM. Ignora
 * quaisquer campos extras (ex.: label) — lê apenas split/stratum/reviewContext/tag.
 */
export function computeCarryoverComposition(works: CarryoverWork[]): CarryoverComposition {
  const bySplit: SplitMap = { development: 0, holdout: 0 }
  const byStratum = emptyStratumMap()
  const matrix = emptyMatrix()
  const reviewContext: Record<ReviewContextKey, number> = { digest_available: 0, no_reviews_available: 0 }
  const tagContext: Record<TagContextKey, number> = {
    tags_present: 0,
    no_tags_legitimate: 0,
    missing_recoverable_frozen_empty: 0,
  }
  for (const w of works) {
    bySplit[w.split]++
    byStratum[w.stratum]++
    matrix[w.split][w.stratum]++
    if (w.reviewContext) reviewContext[w.reviewContext]++
    if (w.tagContextType) tagContext[w.tagContextType]++
  }
  return { total: works.length, bySplit, byStratum, matrix, reviewContext, tagContext }
}

// ── Quotas de stratum ────────────────────────────────────────────────────────

/**
 * Quota BALANCEADA determinística de `total` entre os 4 strata. Base = ⌊total/4⌋; o
 * resto é distribuído +1 por stratum aos de MENOR déficit-base (`base − carryover`) — para
 * **não agravar os maiores déficits** (critério 1). Desempate: ordem ordinal do stratum
 * (♥ < ♥♥ < ♥♥♥ < ♥♥♥♥) — determinístico e documentado (critério 4).
 */
export function distributeStrataQuotaBalanced(total: number, carryoverByStratum: StratumMap): StratumMap {
  const base = Math.floor(total / 4)
  let remainder = total - base * 4
  const target: StratumMap = { "♥": base, "♥♥": base, "♥♥♥": base, "♥♥♥♥": base }
  // candidatos ordenados por déficit-base ASC, depois por ordem ordinal do stratum
  const ranked = [...STRATA]
    .map((s, idx) => ({ s, idx, deficit: base - carryoverByStratum[s] }))
    .sort((a, b) => a.deficit - b.deficit || a.idx - b.idx)
  for (const c of ranked) {
    if (remainder <= 0) break
    target[c.s] += 1
    remainder--
  }
  return target
}

/**
 * Quota PROPORCIONAL (minimiza alteração vs. a forma dos carryovers): cada stratum recebe
 * `total × carryover_s / Σcarryover`, com arredondamento por MAIOR RESTO (desempate por
 * ordem ordinal). Soma exatamente `total`.
 */
export function distributeStrataQuotaProportional(total: number, carryoverByStratum: StratumMap): StratumMap {
  const sum = STRATA.reduce((a, s) => a + carryoverByStratum[s], 0)
  if (sum === 0) return distributeStrataQuotaBalanced(total, carryoverByStratum)
  const raw = STRATA.map((s, idx) => {
    const exact = (total * carryoverByStratum[s]) / sum
    return { s, idx, floor: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let assigned = raw.reduce((a, r) => a + r.floor, 0)
  const target = emptyStratumMap()
  for (const r of raw) target[r.s] = r.floor
  const order = [...raw].sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  for (const r of order) {
    if (assigned >= total) break
    target[r.s] += 1
    assigned++
  }
  return target
}

// ── Split + matriz de células ─────────────────────────────────────────────────

export function computeSplitTargets(total: number, development: number, holdout: number): SplitMap {
  if (development + holdout !== total) {
    throw new Error(`split targets (${development}+${holdout}) != total (${total})`)
  }
  return { development, holdout }
}

/**
 * Aloca a matriz split×stratum determinística: cada `stratumTarget[s]` é dividido entre os
 * splits na proporção `splitTargets`, com arredondamento por maior resto na COLUNA dev para
 * garantir que a coluna some exatamente `splitTargets.development`. Linhas somam o stratum;
 * colunas somam o split.
 */
export function allocateCellTargets(stratumTargets: StratumMap, splitTargets: SplitMap): Matrix {
  const total = splitTargets.development + splitTargets.holdout
  const raw = STRATA.map((s, idx) => {
    const exact = (stratumTargets[s] * splitTargets.development) / total
    return { s, idx, dev: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let devAssigned = raw.reduce((a, r) => a + r.dev, 0)
  const order = [...raw].sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  for (const r of order) {
    if (devAssigned >= splitTargets.development) break
    r.dev += 1
    devAssigned++
  }
  const matrix = emptyMatrix()
  for (const r of raw) {
    matrix.development[r.s] = r.dev
    matrix.holdout[r.s] = stratumTargets[r.s] - r.dev
  }
  return matrix
}

// ── Déficits + plano completo ────────────────────────────────────────────────

export function deficit(target: number, carryover: number): number {
  return Math.max(0, target - carryover)
}

export interface CompositionPlan {
  total: number
  totalNew: number
  splitTargets: SplitMap
  stratumTargets: StratumMap
  cellTargets: Matrix
  splitDeficit: SplitMap
  stratumDeficit: StratumMap
  cellDeficit: Matrix
}

export type StrataMode = "balanced" | "proportional"

/**
 * Plano de composição completo. `splitTargets` é dado (decisão Q3); `stratumTargets` é
 * derivado determinísticamente (modo `balanced` = Opção 1, `proportional` = Opção 2). A
 * matriz de células e todos os déficits saem disso.
 */
export function computeCompositionPlan(input: {
  total: number
  splitTargets: SplitMap
  carryover: CarryoverComposition
  strataMode: StrataMode
}): CompositionPlan {
  const { total, splitTargets, carryover, strataMode } = input
  const stratumTargets =
    strataMode === "proportional"
      ? distributeStrataQuotaProportional(total, carryover.byStratum)
      : distributeStrataQuotaBalanced(total, carryover.byStratum)
  const cellTargets = allocateCellTargets(stratumTargets, splitTargets)

  const splitDeficit: SplitMap = {
    development: deficit(splitTargets.development, carryover.bySplit.development),
    holdout: deficit(splitTargets.holdout, carryover.bySplit.holdout),
  }
  const stratumDeficit = emptyStratumMap()
  for (const s of STRATA) stratumDeficit[s] = deficit(stratumTargets[s], carryover.byStratum[s])
  const cellDeficit = emptyMatrix()
  for (const sp of SPLITS) for (const s of STRATA) cellDeficit[sp][s] = deficit(cellTargets[sp][s], carryover.matrix[sp][s])

  return {
    total,
    totalNew: total - carryover.total,
    splitTargets,
    stratumTargets,
    cellTargets,
    splitDeficit,
    stratumDeficit,
    cellDeficit,
  }
}

// ── Validação ────────────────────────────────────────────────────────────────

function sumStratum(m: StratumMap): number {
  return STRATA.reduce((a, s) => a + m[s], 0)
}
function sumMatrixCol(m: Matrix, sp: Split): number {
  return STRATA.reduce((a, s) => a + m[sp][s], 0)
}
function sumMatrixRow(m: Matrix, s: Stratum): number {
  return SPLITS.reduce((a, sp) => a + m[sp][s], 0)
}

export interface CompositionValidation {
  ok: boolean
  errors: string[]
}

/** Valida coerência do plano (somas, marginais, déficits não-negativos). */
export function validateComposition(plan: CompositionPlan, carryover: CarryoverComposition): CompositionValidation {
  const errors: string[] = []
  if (plan.splitTargets.development + plan.splitTargets.holdout !== plan.total) errors.push("split targets não somam total")
  if (sumStratum(plan.stratumTargets) !== plan.total) errors.push("stratum targets não somam total")
  for (const sp of SPLITS) {
    if (sumMatrixCol(plan.cellTargets, sp) !== plan.splitTargets[sp]) errors.push(`coluna ${sp} da matriz != split target`)
  }
  for (const s of STRATA) {
    if (sumMatrixRow(plan.cellTargets, s) !== plan.stratumTargets[s]) errors.push(`linha ${s} da matriz != stratum target`)
  }
  for (const sp of SPLITS) for (const s of STRATA) if (plan.cellDeficit[sp][s] < 0) errors.push(`déficit negativo em ${sp}/${s}`)
  if (plan.totalNew !== plan.total - carryover.total) errors.push("totalNew incoerente com carryover")
  // soma dos déficits de célula = totalNew SE nenhuma célula estiver super-coberta
  const sumCellDef = SPLITS.reduce((a, sp) => a + STRATA.reduce((b, s) => b + plan.cellDeficit[sp][s], 0), 0)
  const surplus = SPLITS.some((sp) => STRATA.some((s) => plan.cellTargets[sp][s] < carryover.matrix[sp][s]))
  if (!surplus && sumCellDef !== plan.totalNew) errors.push(`soma de déficits de célula (${sumCellDef}) != totalNew (${plan.totalNew})`)
  return { ok: errors.length === 0, errors }
}

// ── Repetições (Parte F) ──────────────────────────────────────────────────────

/**
 * Distribui `count` slots repetidos entre os splits de forma determinística. As repetições
 * são slots EXTRA: **não** contam como obras únicas (não entram na composição de 90).
 */
export function distributeRepeats(count: number, development: number, holdout: number): SplitMap {
  if (development + holdout !== count) throw new Error(`repeats (${development}+${holdout}) != count (${count})`)
  return { development, holdout }
}
