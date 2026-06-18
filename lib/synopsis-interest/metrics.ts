/**
 * Métricas PURAS do experimento de Interesse na Sinopse (Plano 3 Fase B).
 * Sem banco, sem Date, sem random. Duas famílias:
 *   1) Concordância ORDINAL (previsão × golden humano) — métrica primária.
 *   2) Métricas de ranking (downstream vs user_score) — Spearman, pairwise, NDCG,
 *      top-K, MAE. user_score é SÓ downstream (nunca ground truth do interesse).
 */

import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"

/** ♥→1 … ♥♥♥♥→4; 0 se desconhecido. */
export function levelOf(q: string | null | undefined): number {
  if (!q) return 0
  const i = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return i >= 0 ? i + 1 : 0
}

export function levelToQuality(level: number): SynopsisQuality {
  const i = Math.min(SYNOPSIS_QUALITIES.length, Math.max(1, Math.round(level))) - 1
  return SYNOPSIS_QUALITIES[i]!
}

// ── 1) Concordância ordinal ──────────────────────────────────────────────────

export interface OrdinalAgreement {
  n: number
  exactRate: number | null
  within1Rate: number | null
  /** Erro absoluto médio em níveis. */
  mae: number | null
  /** Viés médio (pred − gold). + = superestima. */
  bias: number | null
  /** Quadratic Weighted Kappa (−1..1): concordância corrigida pelo acaso. */
  qwk: number | null
}

export interface LevelPair {
  pred: number
  gold: number
}

export function ordinalAgreement(pairs: LevelPair[]): OrdinalAgreement {
  const valid = pairs.filter((p) => p.pred >= 1 && p.gold >= 1)
  const n = valid.length
  if (n === 0) return { n: 0, exactRate: null, within1Rate: null, mae: null, bias: null, qwk: null }
  let exact = 0, within1 = 0, abs = 0, signed = 0
  for (const p of valid) {
    const d = p.pred - p.gold
    if (d === 0) exact += 1
    if (Math.abs(d) <= 1) within1 += 1
    abs += Math.abs(d)
    signed += d
  }
  return {
    n,
    exactRate: exact / n,
    within1Rate: within1 / n,
    mae: abs / n,
    bias: signed / n,
    qwk: quadraticWeightedKappa(valid),
  }
}

/** QWK sobre 4 categorias (1..4). Determinístico. */
export function quadraticWeightedKappa(pairs: LevelPair[], categories = 4): number | null {
  const n = pairs.length
  if (n === 0) return null
  const O = Array.from({ length: categories }, () => new Array(categories).fill(0))
  const rowHist = new Array(categories).fill(0)
  const colHist = new Array(categories).fill(0)
  for (const p of pairs) {
    const r = Math.min(categories, Math.max(1, p.pred)) - 1
    const c = Math.min(categories, Math.max(1, p.gold)) - 1
    O[r]![c]! += 1
    rowHist[r] += 1
    colHist[c] += 1
  }
  let num = 0, den = 0
  const denomW = (categories - 1) ** 2
  for (let i = 0; i < categories; i += 1) {
    for (let j = 0; j < categories; j += 1) {
      const w = ((i - j) ** 2) / denomW
      const e = (rowHist[i] * colHist[j]) / n
      num += w * O[i]![j]!
      den += w * e
    }
  }
  if (den === 0) return 1 // sem variância esperada → concordância perfeita por convenção
  return 1 - num / den
}

// ── 2) Métricas de ranking / downstream ──────────────────────────────────────

/** Spearman ρ entre dois vetores (com correção de empates por ranks médios). */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n !== ys.length || n < 2) return null
  const rx = averageRanks(xs)
  const ry = averageRanks(ys)
  return pearson(rx, ry)
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx, dy = ys[i]! - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

function averageRanks(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array(xs.length).fill(0)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j += 1
    const avg = (i + j) / 2 + 1 // ranks 1-based, média dos empatados
    for (let k = i; k <= j; k += 1) ranks[idx[k]!.i] = avg
    i = j + 1
  }
  return ranks
}

/**
 * Acurácia pareada: fração dos pares (a,b) em que a ORDEM do score bate com a
 * ordem da verdade. Pares com empate na verdade são ignorados.
 */
export function pairwiseAccuracy(items: Array<{ score: number; truth: number }>): number | null {
  let concordant = 0, comparable = 0
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const dt = items[i]!.truth - items[j]!.truth
      if (dt === 0) continue
      const ds = items[i]!.score - items[j]!.score
      if (ds === 0) continue
      comparable += 1
      if (Math.sign(ds) === Math.sign(dt)) concordant += 1
    }
  }
  return comparable === 0 ? null : concordant / comparable
}

/** NDCG@k de uma lista já ORDENADA pelo score do modelo (relevâncias na ordem). */
export function ndcgAtK(rankedRelevances: number[], k: number): number | null {
  if (rankedRelevances.length === 0) return null
  const dcg = (rels: number[]) =>
    rels.slice(0, k).reduce((acc, rel, i) => acc + (2 ** rel - 1) / Math.log2(i + 2), 0)
  const ideal = [...rankedRelevances].sort((a, b) => b - a)
  const idcg = dcg(ideal)
  return idcg === 0 ? null : dcg(rankedRelevances) / idcg
}

/** Sobreposição de top-K entre duas ordenações (fração do K). */
export function topKOverlap(a: string[], b: string[], k: number): number | null {
  if (k <= 0) return null
  const ak = new Set(a.slice(0, k))
  const bk = b.slice(0, k)
  let common = 0
  for (const x of bk) if (ak.has(x)) common += 1
  return common / Math.min(k, Math.max(a.length, b.length) || k)
}

// ── 3) Consistência intra-avaliador (repetições cegas) ───────────────────────

export interface IntraRater {
  n: number
  exactRate: number | null
  within1Rate: number | null
  mae: number | null
}

export function intraRaterConsistency(pairs: Array<{ a: number; b: number }>): IntraRater {
  const valid = pairs.filter((p) => p.a >= 1 && p.b >= 1)
  const n = valid.length
  if (n === 0) return { n: 0, exactRate: null, within1Rate: null, mae: null }
  let exact = 0, within1 = 0, abs = 0
  for (const p of valid) {
    const d = Math.abs(p.a - p.b)
    if (d === 0) exact += 1
    if (d <= 1) within1 += 1
    abs += d
  }
  return { n, exactRate: exact / n, within1Rate: within1 / n, mae: abs / n }
}
