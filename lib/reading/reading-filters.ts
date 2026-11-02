import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { VISIBLE_CRITERION_SLUGS } from "@/lib/criteria/visible"
import { INTEREST_NONE, matchesManualInterest, sanitizeInterestSelection } from "@/lib/interest-sentinels"
import { SCORE_GRID } from "@/lib/ranking/criterion-unit"
import { formatThresholdNumber, numParam } from "@/lib/ranking/score-threshold"
import type { ThresholdScale } from "@/lib/ranking/score-threshold"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * Os filtros do /reading (Acompanhamento) — dono único da régua. Módulo PURO: a lista já vem inteira
 * do servidor e o filtro roda no cliente, sem consulta nova.
 *
 * A URL fala a MESMA língua do /ranking (`adult`, `synopsis_q`, `min_<slug>`, `max_<slug>`,
 * `min_expected`, `min_align`), sempre em PONTOS — ver "A query string do /ranking é um CONTRATO".
 *
 * 🔴 A diferença para o /ranking é uma só, e é de propósito: lá a pergunta é "esta obra serve para
 * mim?", e uma `mixed` passa em "Ocultar" pela versão normal. Aqui a lista é do que a pessoa ESTÁ
 * LENDO, então a `mixed` segue a versão lida (`user_work_state.read_edition`, decisão da Ana em
 * 2026-11-01). Sem versão marcada ela fica nos dois lados: não dá para afirmar nenhum dos dois.
 */

export type ReadingAdultMode = "all" | "hide" | "only"

/** O que vale numa edição de uma obra `mixed` — nunca a nota da outra edição. */
export interface ReadingEditionValues {
  expectedScore: number | null
  adultContent: number | null
}

/** Os campos de uma obra que os filtros consultam. */
export interface ReadingFilterFields {
  isAdult: boolean
  isMixed: boolean
  synopsisQuality: string | null
  /** A versão que a pessoa lê (`read_edition`). Só faz sentido em `mixed`. */
  readEdition: MixedEdition | null
  /** A edição padrão desta pessoa nesta obra (`resolveMixedEdition`). `null` fora das `mixed`. */
  defaultEdition: MixedEdition | null
  expectedScore: number | null
  alignmentScore: number | null
  /** Notas de `category_scores`. Em `mixed`, o `adult_content` daqui NÃO vale: é a nota misturada. */
  criterionScores: Record<string, number>
  /** Só nas `mixed`. */
  byEdition: Record<MixedEdition, ReadingEditionValues> | null
}

export interface ReadingScoreField extends ThresholdScale {
  key: string
  emoji: string
  /** Rótulo curto, o que cabe na pílula e no chip. */
  label: string
  /** Nome completo (tooltip). */
  fullLabel: string
  minKey: string
  maxKey: string
  presets: number[]
  /** Atalhos de teto: em "quero algo leve" a pergunta é `≤`, não `≥`. */
  maxPresets: number[]
  /** Passo do slider, quando é mais fino que o rótulo. */
  sliderStep?: number
  /** Obra sem esta nota continua na lista (mesma régua do /ranking para o Veredito). */
  absentPasses?: boolean
  /** Escala bipolar: o que cada ponta quer dizer. */
  poles?: readonly [string, string]
}

/** O rótulo longo não cabe na pílula; o nome oficial segue no tooltip. */
const ATTRIBUTE_LABEL: Record<string, string> = {
  couple_dynamics: "Casal",
  setting_era: "Ambientação",
  action_adventure: "Dinamismo",
  adult_content: "Cont. adulto",
  protagonist: "Protagonista",
}

const ATTRIBUTE_POLES: Record<string, readonly [string, string]> = {
  setting_era: ["0: histórica", "10: contemporânea"],
  action_adventure: ["0: rotina", "10: eventos e perigo"],
}

export const READING_NOTE_FIELDS: readonly ReadingScoreField[] = [
  {
    key: "expected",
    emoji: "🎯",
    label: LABELS.expected_score.short,
    fullLabel: LABELS.expected_score.full,
    minKey: "min_expected",
    maxKey: "max_expected",
    min: 0,
    max: 10,
    step: 0.5,
    presets: [7, 7.5, 8, 8.5],
    maxPresets: [],
  },
  {
    key: "align",
    emoji: "🤖",
    label: LABELS.alignment_score.short,
    fullLabel: LABELS.alignment_score.full,
    minKey: "min_align",
    maxKey: "max_align",
    min: 0,
    max: 100,
    step: 5,
    presets: [40, 60, 80],
    maxPresets: [40],
    absentPasses: true,
  },
]

// Derivado de VISIBLE_CRITERION_SLUGS: critério novo no Supabase entra no painel sozinho.
export const READING_ATTRIBUTE_FIELDS: readonly ReadingScoreField[] = VISIBLE_CRITERION_SLUGS.map((slug) => {
  const name = CRITERIA_INFO[slug]?.name ?? slug
  return {
    key: slug,
    emoji: CRITERIA_INFO[slug]?.emoji ?? "",
    label: ATTRIBUTE_LABEL[slug] ?? name,
    fullLabel: name,
    minKey: `min_${slug}`,
    maxKey: `max_${slug}`,
    min: 0,
    max: 10,
    // Passo 1 no rótulo (como no /ranking: "≥ 8", não "≥ 8,0"); as notas existem de 0,5 em 0,5.
    step: 1,
    sliderStep: SCORE_GRID,
    grid: SCORE_GRID,
    presets: [5, 6, 7, 8, 9],
    maxPresets: [3, 5],
    poles: ATTRIBUTE_POLES[slug],
  }
})

export const READING_SCORE_FIELDS: readonly ReadingScoreField[] = [...READING_NOTE_FIELDS, ...READING_ATTRIBUTE_FIELDS]

export interface ReadingScoreRange {
  min?: number
  max?: number
}

export interface ReadingFilters {
  adult: ReadingAdultMode
  /** Vazio = sem filtro. Contém ♥ e/ou `INTEREST_NONE`. */
  interest: ReadonlySet<string>
  /** Só os campos com limiar. */
  ranges: Readonly<Record<string, ReadingScoreRange>>
}

const INTEREST_VALUES: ReadonlySet<string> = new Set([...SYNOPSIS_QUALITIES, INTEREST_NONE])

export function parseReadingFilters(params: Pick<URLSearchParams, "get">): ReadingFilters {
  const rawAdult = params.get("adult")
  const adult: ReadingAdultMode = rawAdult === "hide" || rawAdult === "only" ? rawAdult : "all"

  const csv = params.get("synopsis_q")?.split(",").filter(Boolean)
  const interest = new Set((sanitizeInterestSelection(csv) ?? []).filter((v) => INTEREST_VALUES.has(v)))

  const ranges: Record<string, ReadingScoreRange> = {}
  for (const field of READING_SCORE_FIELDS) {
    const min = numParam(params.get(field.minKey))
    const max = numParam(params.get(field.maxKey))
    // Limiar na ponta da escala não corta nada: sem isto, uma URL à mão criaria chip sem recorte.
    const range: ReadingScoreRange = {}
    if (min != null && min > field.min) range.min = min
    if (max != null && max < field.max) range.max = max
    if (range.min != null || range.max != null) ranges[field.key] = range
  }
  return { adult, interest, ranges }
}

/** Quantos filtros estão ligados — o número do botão. Cada dimensão conta uma vez. */
export function activeReadingFilterCount(filters: ReadingFilters): number {
  return (filters.adult === "all" ? 0 : 1) + (filters.interest.size > 0 ? 1 : 0) + Object.keys(filters.ranges).length
}

/** Tudo que `updateParams` precisa para zerar os filtros, sem tocar em mais nada da URL. */
export function clearedReadingFilterParams(): Record<string, null> {
  const out: Record<string, null> = { adult: null, synopsis_q: null }
  for (const field of READING_SCORE_FIELDS) {
    out[field.minKey] = null
    out[field.maxKey] = null
  }
  return out
}

/**
 * A edição que vale para ler as notas de uma `mixed` nesta lista.
 *
 * Com o filtro de 18+ ligado, a própria escolha decide (a mesma precedência de
 * `resolveMixedEdition`); sem ele, a versão que a pessoa lê e, sem versão marcada, o padrão dela.
 */
export function readingEditionFor(work: ReadingFilterFields, adult: ReadingAdultMode): MixedEdition | null {
  if (!work.isMixed) return null
  if (adult === "hide") return "normal"
  if (adult === "only") return "r18"
  return work.readEdition ?? work.defaultEdition
}

/** Passa no filtro de 18+? Ver o cabeçalho: a `mixed` segue a versão lida. */
export function passesReadingAdultFilter(
  work: Pick<ReadingFilterFields, "isAdult" | "isMixed" | "readEdition">,
  mode: ReadingAdultMode,
): boolean {
  if (mode === "all") return true
  if (work.isAdult) return mode === "only"
  if (!work.isMixed) return mode === "hide"
  if (work.readEdition === "r18") return mode === "only"
  if (work.readEdition === "normal") return mode === "hide"
  return true
}

/** O valor da nota nesta lista. `null` = a obra não tem esta nota (nesta edição). */
export function readingScoreValue(
  work: ReadingFilterFields,
  field: Pick<ReadingScoreField, "key">,
  adult: ReadingAdultMode,
): number | null {
  const edition = readingEditionFor(work, adult)
  const ofEdition = edition ? work.byEdition?.[edition] : undefined
  if (field.key === "align") return work.alignmentScore
  if (field.key === "expected") {
    // Filtra pelo número da tela: 7,96 imprime "8,0" e tem de passar em "≥ 8" (`roundToDisplayScore`).
    const value = work.isMixed ? (ofEdition?.expectedScore ?? null) : work.expectedScore
    return value == null ? null : roundToDisplayScore(value)
  }
  // 🔴 Nunca cair na nota de `category_scores` numa mixed: ela é a misturada das duas edições.
  if (field.key === "adult_content" && work.isMixed) return ofEdition?.adultContent ?? null
  return work.criterionScores[field.key] ?? null
}

function passesRange(value: number | null, range: ReadingScoreRange, absentPasses: boolean | undefined): boolean {
  if (value == null) return !!absentPasses
  return (range.min == null || value >= range.min) && (range.max == null || value <= range.max)
}

export function matchesReadingFilters(work: ReadingFilterFields, filters: ReadingFilters): boolean {
  if (!passesReadingAdultFilter(work, filters.adult)) return false
  if (filters.interest.size > 0 && !matchesManualInterest(work, filters.interest)) return false
  for (const field of READING_SCORE_FIELDS) {
    const range = filters.ranges[field.key]
    if (!range) continue
    if (!passesRange(readingScoreValue(work, field, filters.adult), range, field.absentPasses)) return false
  }
  return true
}

/** O número de cada opção: quantas obras sobrariam com esta escolha, mantidos os outros filtros. */
export function countReadingWorks(works: readonly ReadingFilterFields[], filters: ReadingFilters): number {
  return works.reduce((n, w) => n + (matchesReadingFilters(w, filters) ? 1 : 0), 0)
}

/** Os mesmos filtros, sem o limiar deste campo — a base do histograma e dos atalhos. */
export function withoutReadingRange(filters: ReadingFilters, key: string): ReadingFilters {
  const ranges = { ...filters.ranges }
  delete ranges[key]
  return { ...filters, ranges }
}

export interface ReadingHistogramBin {
  value: number
  count: number
  inRange: boolean
}

/** A distribuição do campo nas obras que passam nos OUTROS filtros, um degrau por passo do slider. */
export function readingScoreHistogram(
  works: readonly ReadingFilterFields[],
  filters: ReadingFilters,
  field: ReadingScoreField,
): ReadingHistogramBin[] {
  const size = field.sliderStep ?? field.step
  const total = Math.round((field.max - field.min) / size) + 1
  const counts = new Array<number>(total).fill(0)
  const others = withoutReadingRange(filters, field.key)
  for (const work of works) {
    if (!matchesReadingFilters(work, others)) continue
    const value = readingScoreValue(work, field, filters.adult)
    if (value == null) continue
    const index = Math.min(total - 1, Math.max(0, Math.floor((value - field.min) / size + 1e-9)))
    counts[index] = (counts[index] ?? 0) + 1
  }
  const range = filters.ranges[field.key]
  return counts.map((count, i) => {
    const value = field.min + i * size
    return {
      value,
      count,
      inRange: (range?.min == null || value >= range.min) && (range?.max == null || value <= range.max),
    }
  })
}

/** Texto do limiar — o mesmo formatador do /ranking. */
export function formatReadingRange(field: Pick<ReadingScoreField, "step">, range: ReadingScoreRange): string {
  const f = (v: number) => formatThresholdNumber(v, field.step)
  if (range.min != null && range.max != null) return `${f(range.min)}–${f(range.max)}`
  if (range.min != null) return `≥ ${f(range.min)}`
  if (range.max != null) return `≤ ${f(range.max)}`
  return "Qualquer"
}

/** Quanto cada obra vale no campo, para o eco no card. */
export function formatReadingScore(field: Pick<ReadingScoreField, "key" | "step">, value: number): string {
  return field.key === "expected" ? value.toFixed(1).replace(".", ",") : formatThresholdNumber(value, field.step)
}

export interface ReadingFilterChip {
  id: string
  label: string
  /** Em que tom o chip imprime os corações, quando é de Interesse. */
  hearts?: boolean
  clear: Record<string, string | null>
}

/** Um chip por escolha ligada, cada um sabendo como se desfazer. */
export function readingFilterChips(filters: ReadingFilters): ReadingFilterChip[] {
  const chips: ReadingFilterChip[] = []
  if (filters.adult !== "all") {
    chips.push({
      id: "adult",
      label: filters.adult === "hide" ? "18+: ocultar" : "18+: só 18+",
      clear: { adult: null },
    })
  }
  for (const value of [...[...SYNOPSIS_QUALITIES].reverse(), INTEREST_NONE]) {
    if (!filters.interest.has(value)) continue
    const rest = [...filters.interest].filter((v) => v !== value)
    chips.push({
      id: `interest:${value}`,
      label: value === INTEREST_NONE ? "Sem interesse marcado" : value,
      hearts: value !== INTEREST_NONE,
      clear: { synopsis_q: rest.length > 0 ? rest.join(",") : null },
    })
  }
  for (const field of READING_SCORE_FIELDS) {
    const range = filters.ranges[field.key]
    if (!range) continue
    chips.push({
      id: `range:${field.key}`,
      label: `${field.label} ${formatReadingRange(field, range)}`,
      clear: { [field.minKey]: null, [field.maxKey]: null },
    })
  }
  return chips
}
