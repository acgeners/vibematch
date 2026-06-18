/**
 * Construção DETERMINÍSTICA da golden sample de Interesse na Sinopse
 * (Plano 3 Fase B). Puro: sem banco, sem Date, sem Math.random — a "aleatoriedade"
 * vem de sha256(work_id + salt), estável e reprodutível. Mesma entrada ⇒ mesma
 * amostra (a amostra precisa ser FIXA antes de observar os outputs candidatos).
 *
 * Estratifica pelo label ATUAL só para garantir cobertura dos 4 níveis (o label
 * fica como `stratum`, OCULTO na rotulagem). Cria repetições cegas para medir
 * consistência intra-avaliador. Embaralha a ordem de apresentação.
 */

import { createHash } from "node:crypto"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"

export interface SampleCandidate {
  workId: string
  /** Label atual (works.synopsis_quality) — usado só p/ estratificar. */
  stratum: SynopsisQuality
}

export interface GoldenSlot {
  slotKey: string
  workId: string
  split: "development" | "holdout"
  stratum: SynopsisQuality
  isRepeat: boolean
  repeatOf: string | null
  shuffleOrder: number
}

export interface BuildGoldenSampleOptions {
  /** Alvo de obras únicas por nível. */
  perLevel?: number
  /** Quantas das `perLevel` vão p/ development em cada nível (resto → holdout). */
  devPerLevel?: Partial<Record<SynopsisQuality, number>>
  /** Nº de repetições cegas (obras re-mostradas). Não contam como obras únicas. */
  repeatCount?: number
  sampleVersion?: string
  salt?: string
}

const DEFAULTS = {
  perLevel: 20,
  // 13+13+12+12 = 50 development; resto (7+7+8+8 = 30) → holdout.
  devPerLevel: { "♥": 13, "♥♥": 13, "♥♥♥": 12, "♥♥♥♥": 12 } as Record<SynopsisQuality, number>,
  repeatCount: 10,
  sampleVersion: "pilot-1",
  salt: "synopsis-interest-pilot-1",
} as const

/** Hash estável → número [0,1) a partir de uma string. Determinístico. */
function stableUnit(s: string): number {
  const hex = createHash("sha256").update(s).digest("hex").slice(0, 13) // 52 bits
  return parseInt(hex, 16) / 2 ** 52
}

function pad(n: number): string {
  return String(n).padStart(3, "0")
}

/**
 * Monta a golden sample. Retorna os slots (únicos + repetições) já com a ordem
 * de apresentação embaralhada de forma determinística.
 */
export function buildGoldenSample(
  candidates: SampleCandidate[],
  opts: BuildGoldenSampleOptions = {},
): GoldenSlot[] {
  const perLevel = opts.perLevel ?? DEFAULTS.perLevel
  const devPerLevel = opts.devPerLevel ?? DEFAULTS.devPerLevel
  const repeatCount = opts.repeatCount ?? DEFAULTS.repeatCount
  const salt = opts.salt ?? DEFAULTS.salt

  // 1) Estratifica e escolhe perLevel por nível, ordenando por hash estável.
  const chosen: SampleCandidate[] = []
  for (const level of SYNOPSIS_QUALITIES) {
    const pool = candidates
      .filter((c) => c.stratum === level)
      .sort((a, b) => stableUnit(`${salt}:pick:${a.workId}`) - stableUnit(`${salt}:pick:${b.workId}`))
    chosen.push(...pool.slice(0, perLevel))
  }

  // 2) Atribui split por nível (primeiros devN → development, resto → holdout).
  const uniqueSlots: GoldenSlot[] = []
  let idx = 0
  for (const level of SYNOPSIS_QUALITIES) {
    const inLevel = chosen.filter((c) => c.stratum === level)
    const devN = devPerLevel[level] ?? Math.round(inLevel.length * 0.625)
    inLevel.forEach((c, i) => {
      idx += 1
      uniqueSlots.push({
        slotKey: `S${pad(idx)}`,
        workId: c.workId,
        split: i < devN ? "development" : "holdout",
        stratum: c.stratum,
        isRepeat: false,
        repeatOf: null,
        shuffleOrder: 0,
      })
    })
  }

  // 3) Repetições cegas: escolhe repeatCount dos únicos por hash estável.
  const repeatSource = [...uniqueSlots].sort(
    (a, b) => stableUnit(`${salt}:rep:${a.workId}`) - stableUnit(`${salt}:rep:${b.workId}`),
  )
  const repeatSlots: GoldenSlot[] = repeatSource.slice(0, repeatCount).map((orig, i) => ({
    slotKey: `R${pad(i + 1)}`,
    workId: orig.workId,
    split: orig.split,
    stratum: orig.stratum,
    isRepeat: true,
    repeatOf: orig.slotKey,
    shuffleOrder: 0,
  }))

  // 4) Embaralha a ordem de apresentação (únicos + repetições) por hash estável.
  const all = [...uniqueSlots, ...repeatSlots].sort(
    (a, b) => stableUnit(`${salt}:shuffle:${a.slotKey}`) - stableUnit(`${salt}:shuffle:${b.slotKey}`),
  )
  all.forEach((slot, i) => {
    slot.shuffleOrder = i + 1
  })
  return all
}

export interface SampleSummary {
  uniqueWorks: number
  repeats: number
  byStratum: Record<string, { development: number; holdout: number }>
}

/** Resumo p/ revisão da amostra (distribuição dos estratos × split). */
export function summarizeSample(slots: GoldenSlot[]): SampleSummary {
  const unique = slots.filter((s) => !s.isRepeat)
  const byStratum: Record<string, { development: number; holdout: number }> = {}
  for (const s of unique) {
    const e = (byStratum[s.stratum] ??= { development: 0, holdout: 0 })
    e[s.split] += 1
  }
  return {
    uniqueWorks: unique.length,
    repeats: slots.filter((s) => s.isRepeat).length,
    byStratum,
  }
}
