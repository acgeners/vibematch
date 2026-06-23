/**
 * Plano 3 — Seleção DETERMINÍSTICA do pilot-2 (Fase B2.2F). PURO: sem banco, sem rede,
 * sem `server-only`, sem LLM. Seleciona 39 obras novas por stratum/quota usando
 * `sha256(seed + ":" + work_id)` e os 10 repeats com um seed separado.
 *
 * A seleção é INDEPENDENTE de: label humano/contextual, título, output de candidato,
 * previsão, score, ranking, alignment, contagem de reviews, presença de digest, custo,
 * e da ORDEM retornada pelo banco. As únicas entradas são work_id + stratum (+ split alvo
 * derivado da matriz aprovada).
 */

import { createHash } from "node:crypto"
import {
  STRATA,
  SPLITS,
  type Stratum,
  type Split,
  type StratumMap,
  type Matrix,
  type TagContextKey,
} from "./pilot2-composition"

export const SELECTION_SEED = "pilot-2-selection-v1"
export const REPEATS_SEED = "pilot-2-repeats-v1"

/** Quota aprovada por stratum (Q2): 12/4/9/14 = 39. */
export const STRATUM_QUOTA: StratumMap = { "♥": 12, "♥♥": 4, "♥♥♥": 9, "♥♥♥♥": 14 }
/** Matriz aprovada split×stratum das 39 novas (Q3). */
export const CELL_QUOTA: Matrix = {
  development: { "♥": 7, "♥♥": 1, "♥♥♥": 4, "♥♥♥♥": 11 },
  holdout: { "♥": 5, "♥♥": 3, "♥♥♥": 5, "♥♥♥♥": 3 },
}
/** Repeats (Q4): 10 = 6 dev / 4 hold. */
export const REPEATS_SPLIT: Record<Split, number> = { development: 6, holdout: 4 }
export const REPEATS_TOTAL = 10

export function selectionHash(seed: string, workId: string): string {
  return createHash("sha256").update(`${seed}:${workId}`).digest("hex")
}

/** Obra elegível — SÓ campos estruturais. Nunca label/review/título/output de candidato. */
export interface EligibleWork {
  workId: string
  stratum: Stratum
  /** estado de tags (opcional; NÃO afeta seleção/ordenação). */
  tagState?: TagContextKey
}

export interface SelectedWork {
  workId: string
  stratum: Stratum
  split: Split
  origin: "new"
}

export interface StratumDeficit {
  stratum: Stratum
  available: number
  quota: number
  deficit: number
}

export interface SelectionResult {
  ok: boolean
  deficits: StratumDeficit[]
  selected: SelectedWork[]
  eligibleByStratum: StratumMap
  reservesByStratum: StratumMap
  seed: string
  canonicalListHash: string
}

function emptyStratumMap(): StratumMap {
  return { "♥": 0, "♥♥": 0, "♥♥♥": 0, "♥♥♥♥": 0 }
}

/** Hash canônico de uma lista de work_ids (ordenada). */
export function canonicalListHash(workIds: string[]): string {
  return createHash("sha256").update([...workIds].sort().join("\n")).digest("hex")
}

/**
 * Seleção determinística das 39. Dentro de cada stratum: ordena por
 * `sha256(seed:work_id)` (desempate por work_id), pega a quota e atribui split pela matriz
 * (os primeiros `cellQuota.development[s]` → development; o resto → holdout). Se QUALQUER
 * stratum tiver menos elegíveis que a quota, **para** (sem seleção parcial, sem transferir
 * vagas) e devolve os déficits.
 */
export function selectNewWorks(input: {
  pool: EligibleWork[]
  seed?: string
  stratumQuota?: StratumMap
  cellQuota?: Matrix
}): SelectionResult {
  const seed = input.seed ?? SELECTION_SEED
  const stratumQuota = input.stratumQuota ?? STRATUM_QUOTA
  const cellQuota = input.cellQuota ?? CELL_QUOTA

  const byStratum: Record<Stratum, EligibleWork[]> = { "♥": [], "♥♥": [], "♥♥♥": [], "♥♥♥♥": [] }
  const eligibleByStratum = emptyStratumMap()
  for (const w of input.pool) {
    if (!STRATA.includes(w.stratum)) continue
    byStratum[w.stratum].push(w)
    eligibleByStratum[w.stratum]++
  }

  // gate de capacidade — tudo ou nada
  const deficits: StratumDeficit[] = []
  for (const s of STRATA) {
    const available = eligibleByStratum[s]
    const quota = stratumQuota[s]
    if (available < quota) deficits.push({ stratum: s, available, quota, deficit: quota - available })
  }
  if (deficits.length > 0) {
    return {
      ok: false,
      deficits,
      selected: [],
      eligibleByStratum,
      reservesByStratum: emptyStratumMap(),
      seed,
      canonicalListHash: "",
    }
  }

  const selected: SelectedWork[] = []
  const reservesByStratum = emptyStratumMap()
  for (const s of STRATA) {
    const ranked = [...byStratum[s]].sort((a, b) => {
      const ha = selectionHash(seed, a.workId)
      const hb = selectionHash(seed, b.workId)
      return ha < hb ? -1 : ha > hb ? 1 : a.workId.localeCompare(b.workId)
    })
    const take = ranked.slice(0, stratumQuota[s])
    reservesByStratum[s] = ranked.length - take.length
    const devQuota = cellQuota.development[s]
    take.forEach((w, i) => {
      const split: Split = i < devQuota ? "development" : "holdout"
      selected.push({ workId: w.workId, stratum: s, split, origin: "new" })
    })
  }
  // saída em ordem canônica por work_id (estável; independe da entrada)
  selected.sort((a, b) => a.workId.localeCompare(b.workId))

  return {
    ok: true,
    deficits: [],
    selected,
    eligibleByStratum,
    reservesByStratum,
    seed,
    canonicalListHash: canonicalListHash(selected.map((w) => w.workId)),
  }
}

// ── Repeats (Parte E) ─────────────────────────────────────────────────────────

export interface RepeatWork {
  workId: string
  stratum: Stratum
  split: Split
}
export interface RepeatsResult {
  ok: boolean
  repeats: RepeatWork[]
  /** distribuição por split×stratum aplicada. */
  distribution: Matrix
  seed: string
  canonicalListHash: string
  error?: string
}

/**
 * Distribui `count` repeats entre os 4 strata proporcional aos tamanhos das células
 * (`cellSizes`), por maior resto (desempate por ordem ordinal), respeitando a CAPACIDADE
 * de cada célula. Determinístico.
 */
export function allocateRepeatsAcrossStrata(count: number, cellSizes: StratumMap): StratumMap {
  const total = STRATA.reduce((a, s) => a + cellSizes[s], 0)
  const alloc = emptyStratumMap()
  if (total === 0 || count === 0) return alloc
  const raw = STRATA.map((s, idx) => {
    const exact = (count * cellSizes[s]) / total
    const floor = Math.min(Math.floor(exact), cellSizes[s])
    return { s, idx, floor, frac: exact - Math.floor(exact) }
  })
  for (const r of raw) alloc[r.s] = r.floor
  let assigned = raw.reduce((a, r) => a + r.floor, 0)
  // distribui o resto aos de maior frac com capacidade sobrando (desempate por ordem)
  const order = [...raw].sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  let guard = 0
  while (assigned < count && guard++ < 1000) {
    let placed = false
    for (const r of order) {
      if (assigned >= count) break
      if (alloc[r.s] < cellSizes[r.s]) {
        alloc[r.s]++
        assigned++
        placed = true
      }
    }
    if (!placed) break // sem capacidade restante
  }
  return alloc
}

/**
 * Seleciona 10 repeats DISTINTOS entre as 39 novas. Para cada split, distribui a quota
 * (6 dev / 4 hold) entre os strata pela capacidade das células e, dentro de cada célula,
 * ordena por `sha256(repeatSeed:work_id)` e pega os primeiros. Cada repeat fica no MESMO
 * split da obra original. Não usa labels nem outputs.
 */
export function selectRepeats(input: {
  newSelected: SelectedWork[]
  seed?: string
  repeatsSplit?: Record<Split, number>
}): RepeatsResult {
  const seed = input.seed ?? REPEATS_SEED
  const repeatsSplit = input.repeatsSplit ?? REPEATS_SPLIT

  // células: new works por split×stratum
  const cells: Record<Split, Record<Stratum, SelectedWork[]>> = {
    development: { "♥": [], "♥♥": [], "♥♥♥": [], "♥♥♥♥": [] },
    holdout: { "♥": [], "♥♥": [], "♥♥♥": [], "♥♥♥♥": [] },
  }
  for (const w of input.newSelected) cells[w.split][w.stratum].push(w)

  const distribution: Matrix = {
    development: emptyStratumMap(),
    holdout: emptyStratumMap(),
  }
  const repeats: RepeatWork[] = []
  for (const sp of SPLITS) {
    const sizes: StratumMap = emptyStratumMap()
    for (const s of STRATA) sizes[s] = cells[sp][s].length
    const want = repeatsSplit[sp]
    const totalCap = STRATA.reduce((a, s) => a + sizes[s], 0)
    if (totalCap < want) {
      return { ok: false, repeats: [], distribution, seed, canonicalListHash: "", error: `repeats ${sp}: capacidade ${totalCap} < ${want}` }
    }
    const perStratum = allocateRepeatsAcrossStrata(want, sizes)
    for (const s of STRATA) {
      distribution[sp][s] = perStratum[s]
      if (perStratum[s] === 0) continue
      const ranked = [...cells[sp][s]].sort((a, b) => {
        const ha = selectionHash(seed, a.workId)
        const hb = selectionHash(seed, b.workId)
        return ha < hb ? -1 : ha > hb ? 1 : a.workId.localeCompare(b.workId)
      })
      for (const w of ranked.slice(0, perStratum[s])) repeats.push({ workId: w.workId, stratum: s, split: sp })
    }
  }
  repeats.sort((a, b) => a.workId.localeCompare(b.workId))
  return { ok: true, repeats, distribution, seed, canonicalListHash: canonicalListHash(repeats.map((r) => r.workId)) }
}

// ── Gate de reviews (Parte G) ─────────────────────────────────────────────────

export interface NewWorkReviewState {
  workId: string
  hasUsefulReviews: boolean
  /** idade (dias) do fetch mais recente; null = sem data confiável. */
  maxFetchAgeDays: number | null
}
export interface ReviewsGateResult {
  ok: boolean
  freshWithReviews: number
  noReviews: number
  blockers: Array<{ workId: string; reason: "stale_reviews" | "no_fetch_date" }>
}

/**
 * Gate de reviews das obras novas. `no_reviews` é apto. Reviews úteis com fetch ≤30d são
 * aptas. Reviews úteis >30d ou sem data confiável **bloqueiam** a materialização de base-2
 * (sem trocar a obra). `freshDays` default 30.
 */
export function evaluateReviewsGate(works: NewWorkReviewState[], freshDays = 30): ReviewsGateResult {
  let freshWithReviews = 0
  let noReviews = 0
  const blockers: ReviewsGateResult["blockers"] = []
  for (const w of works) {
    if (!w.hasUsefulReviews) {
      noReviews++
      continue
    }
    if (w.maxFetchAgeDays == null) blockers.push({ workId: w.workId, reason: "no_fetch_date" })
    else if (w.maxFetchAgeDays > freshDays) blockers.push({ workId: w.workId, reason: "stale_reviews" })
    else freshWithReviews++
  }
  return { ok: blockers.length === 0, freshWithReviews, noReviews, blockers }
}

// ── Definição do pilot-2 (Parte F) ────────────────────────────────────────────

export interface CarryoverEntry {
  workId: string
  stratum: Stratum
  split: Split
}

export interface Pilot2Slot {
  slotKey: string
  workId: string
  split: Split
  stratum: Stratum
  origin: "carryover" | "new"
  isRepeat: boolean
  repeatOf: string | null
}

export interface Pilot2Definition {
  goldenVersion: "pilot-2"
  uniqueWorks: number
  totalSlots: number
  carryoverCount: number
  newCount: number
  repeatCount: number
  splitTotals: Record<Split, number>
  stratumTotals: StratumMap
  slots: Pilot2Slot[]
  /** repeat_slot → original_slot. */
  repeatMap: Array<{ repeatSlot: string; originalSlot: string; workId: string; split: Split; stratum: Stratum }>
  selectionSeed: string
  repeatsSeed: string
}

function padN(n: number, width: number): string {
  return String(n).padStart(width, "0")
}

/**
 * Monta a definição CONGELADA do pilot-2: 90 obras únicas (51 carryover + 39 new) em slots
 * `S001..S090` (ordem canônica por work_id) + 10 repeats em `R001..R010` apontando para o
 * slot da obra original. SEM labels humanos. Determinística.
 */
export function buildPilot2Definition(input: {
  carryovers: CarryoverEntry[]
  newSelected: SelectedWork[]
  repeats: RepeatWork[]
  selectionSeed?: string
  repeatsSeed?: string
}): Pilot2Definition {
  const unique = [
    ...input.carryovers.map((w) => ({ ...w, origin: "carryover" as const })),
    ...input.newSelected.map((w) => ({ workId: w.workId, stratum: w.stratum, split: w.split, origin: "new" as const })),
  ].sort((a, b) => a.workId.localeCompare(b.workId))

  const slotByWorkId = new Map<string, string>()
  const slots: Pilot2Slot[] = unique.map((w, i) => {
    const slotKey = `S${padN(i + 1, 3)}`
    slotByWorkId.set(w.workId, slotKey)
    return { slotKey, workId: w.workId, split: w.split, stratum: w.stratum, origin: w.origin, isRepeat: false, repeatOf: null }
  })

  const repeatMap: Pilot2Definition["repeatMap"] = []
  const sortedRepeats = [...input.repeats].sort((a, b) => a.workId.localeCompare(b.workId))
  sortedRepeats.forEach((r, i) => {
    const repeatSlot = `R${padN(i + 1, 3)}`
    const originalSlot = slotByWorkId.get(r.workId) ?? ""
    slots.push({ slotKey: repeatSlot, workId: r.workId, split: r.split, stratum: r.stratum, origin: "new", isRepeat: true, repeatOf: originalSlot })
    repeatMap.push({ repeatSlot, originalSlot, workId: r.workId, split: r.split, stratum: r.stratum })
  })

  const splitTotals: Record<Split, number> = { development: 0, holdout: 0 }
  const stratumTotals = emptyStratumMap()
  for (const w of unique) {
    splitTotals[w.split]++
    stratumTotals[w.stratum]++
  }

  return {
    goldenVersion: "pilot-2",
    uniqueWorks: unique.length,
    totalSlots: slots.length,
    carryoverCount: input.carryovers.length,
    newCount: input.newSelected.length,
    repeatCount: input.repeats.length,
    splitTotals,
    stratumTotals,
    slots,
    repeatMap,
    selectionSeed: input.selectionSeed ?? SELECTION_SEED,
    repeatsSeed: input.repeatsSeed ?? REPEATS_SEED,
  }
}

export interface Pilot2Validation {
  ok: boolean
  errors: string[]
}

/** Valida a definição contra a composição aprovada (90/100, 56/34, 22/23/23/22, repeats). */
export function validatePilot2Definition(def: Pilot2Definition): Pilot2Validation {
  const errors: string[] = []
  if (def.uniqueWorks !== 90) errors.push(`uniqueWorks ${def.uniqueWorks} != 90`)
  if (def.totalSlots !== 100) errors.push(`totalSlots ${def.totalSlots} != 100`)
  if (def.carryoverCount !== 51) errors.push(`carryoverCount ${def.carryoverCount} != 51`)
  if (def.newCount !== 39) errors.push(`newCount ${def.newCount} != 39`)
  if (def.repeatCount !== 10) errors.push(`repeatCount ${def.repeatCount} != 10`)
  if (def.splitTotals.development !== 56) errors.push(`development ${def.splitTotals.development} != 56`)
  if (def.splitTotals.holdout !== 34) errors.push(`holdout ${def.splitTotals.holdout} != 34`)
  const wantStratum: StratumMap = { "♥": 22, "♥♥": 23, "♥♥♥": 23, "♥♥♥♥": 22 }
  for (const s of STRATA) if (def.stratumTotals[s] !== wantStratum[s]) errors.push(`stratum ${s} ${def.stratumTotals[s]} != ${wantStratum[s]}`)

  // unique work_ids
  const primary = def.slots.filter((s) => !s.isRepeat)
  const ids = new Set(primary.map((s) => s.workId))
  if (ids.size !== 90) errors.push(`work_ids únicos ${ids.size} != 90`)

  // repeats: 10 distintos, todos entre as NEW, mesmo split do original
  const repeatSlots = def.slots.filter((s) => s.isRepeat)
  const repeatIds = new Set(repeatSlots.map((s) => s.workId))
  if (repeatIds.size !== 10) errors.push(`repeats distintos ${repeatIds.size} != 10`)
  const newIds = new Set(primary.filter((s) => s.origin === "new").map((s) => s.workId))
  const primaryById = new Map(primary.map((s) => [s.workId, s]))
  for (const r of repeatSlots) {
    if (!newIds.has(r.workId)) errors.push(`repeat ${r.workId} não é obra nova`)
    const orig = primaryById.get(r.workId)
    if (orig && orig.split !== r.split) errors.push(`repeat ${r.workId} split difere do original`)
  }
  const repDev = repeatSlots.filter((s) => s.split === "development").length
  const repHold = repeatSlots.filter((s) => s.split === "holdout").length
  if (repDev !== 6) errors.push(`repeats development ${repDev} != 6`)
  if (repHold !== 4) errors.push(`repeats holdout ${repHold} != 4`)

  return { ok: errors.length === 0, errors }
}
