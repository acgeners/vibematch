/**
 * Refino por mood — desempate momentâneo DENTRO de um tier de Prioridade.
 *
 * As obras de um tier estão tecnicamente empatadas (diferença de Prioridade
 * dentro do erro do modelo, MAE ~0.9). Em vez de fingir que o modelo separa
 * elas, deixamos o CONTEXTO do user desempatar: ele marca o que quer priorizar
 * agora (atributos como priorizar/evitar + dimensões práticas), e aplicamos uma
 * correção na Prioridade **limitada ao MAE** — honesta, porque só reordena
 * dentro da incerteza que já existe.
 *
 * Puro/determinístico (sem I/O) pra ser testável e rodar client-side: os dados
 * já vêm no RankingEntry/CompareWork.
 */

import type { CriterionSlug } from "@/types/domain"

/**
 * Peso de um atributo numa escala de 5 níveis (0/ausente = neutro):
 *   -2 evitar muito · -1 evitar · (0 neutro) · +1 priorizar · +2 priorizar muito
 * O sinal dá a direção; a magnitude (1 ou 2) dá quanto a dimensão pesa.
 */
export type AttributeWeight = -2 | -1 | 1 | 2

export interface MoodRefine {
  /** Peso por atributo; ausente = neutro (não entra no cálculo). */
  attributes: Partial<Record<CriterionSlug, AttributeWeight>>
  /** Capítulos: prioriza menos (`curto`) ou mais (`longo`) capítulos. */
  chapters?: "curto" | "longo"
  /** Prioriza o que mais combina com o perfil (personalFit). */
  alignment?: boolean
  /** Prioriza o mais popular (volume de votos). */
  popularity?: boolean
  /** Prioriza maior interesse na sinopse (♥..♥♥♥♥). */
  synopsis?: boolean
}

/** Dados mínimos por obra pro scoring (subset de RankingEntry/CompareWork). */
export interface MoodWork {
  id: string
  /** Prioridade base (0–10). null = sem Prevista → não rankeável. */
  decisionScore: number | null
  /** Notas dos 9 atributos (0–10). */
  scores: Partial<Record<CriterionSlug, number | null>>
  totalChapters: number | null
  /** Alinhamento cru com o perfil (0–1). */
  personalFit: number | null
  totalVotes: number
  /** Interesse na sinopse (♥..♥♥♥♥) — ordinal = nº de ♥. */
  synopsisQuality: string | null
}

/**
 * Amplitude máxima da correção, em pontos de Prioridade (0–10). Casada com o
 * MAE (~0.9): a correção por mood nunca empurra uma obra além de ±MOOD_SWING/… do
 * valor base — ou seja, fica dentro da incerteza estatística que já existe.
 */
export const MOOD_SWING = 0.9

export function isMoodActive(mood: MoodRefine): boolean {
  return (
    Object.keys(mood.attributes).length > 0 ||
    mood.chapters != null ||
    mood.alignment === true ||
    mood.popularity === true ||
    mood.synopsis === true
  )
}

interface Dimension {
  accessor: (w: MoodWork) => number | null
  /** true → menor é melhor (evitar / capítulos curtos). */
  invert: boolean
  /** Peso relativo da dimensão na média (atributos: 1 ou 2; práticas: 1). */
  weight: number
}

function activeDimensions(mood: MoodRefine): Dimension[] {
  const dims: Dimension[] = []
  for (const [slug, w] of Object.entries(mood.attributes) as Array<[CriterionSlug, AttributeWeight]>) {
    dims.push({ accessor: (mw) => mw.scores[slug] ?? null, invert: w < 0, weight: Math.abs(w) })
  }
  if (mood.chapters) dims.push({ accessor: (w) => w.totalChapters, invert: mood.chapters === "curto", weight: 1 })
  if (mood.alignment) dims.push({ accessor: (w) => w.personalFit, invert: false, weight: 1 })
  if (mood.popularity) dims.push({ accessor: (w) => w.totalVotes, invert: false, weight: 1 })
  if (mood.synopsis) dims.push({ accessor: (w) => (w.synopsisQuality ? w.synopsisQuality.length : null), invert: false, weight: 1 })
  return dims
}

/** Contribuição [0,1] de uma dimensão pra uma obra, normalizada no cluster. */
function dimensionContribution(dim: Dimension, work: MoodWork, min: number, max: number): number {
  const v = dim.accessor(work)
  if (v == null) return 0.5 // sem dado → neutro
  const norm = max > min ? (v - min) / (max - min) : 0.5
  return dim.invert ? 1 - norm : norm
}

/**
 * `moodFit` [0,1] por obra = média PONDERADA das contribuições das dimensões
 * ativas (peso do atributo: ±±=2, ±=1). Retorna `null` quando não há dimensão
 * ativa (mood vazio).
 */
export function computeMoodFit(works: MoodWork[], mood: MoodRefine): Map<string, number | null> {
  const dims = activeDimensions(mood)
  const out = new Map<string, number | null>()
  if (dims.length === 0) {
    for (const w of works) out.set(w.id, null)
    return out
  }

  // min/max por dimensão sobre o cluster (só valores não-nulos).
  const ranges = dims.map((dim) => {
    let min = Infinity
    let max = -Infinity
    for (const w of works) {
      const v = dim.accessor(w)
      if (v == null) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    return { min, max }
  })

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
  for (const w of works) {
    let sum = 0
    for (let i = 0; i < dims.length; i++) {
      sum += dims[i].weight * dimensionContribution(dims[i], w, ranges[i].min, ranges[i].max)
    }
    out.set(w.id, sum / totalWeight)
  }
  return out
}

/**
 * Prioridade ajustada ao mood (0–10) por obra:
 *   adjusted = base + MOOD_SWING × (moodFit − médiaMoodFit)
 * Centrar na média mantém a correção dentro de ±MOOD_SWING (≈ MAE), então o
 * mood só reordena dentro da incerteza, sem inventar gap. Obras sem Prioridade
 * base (`decisionScore == null`) ficam `null`. Sem dimensão ativa → devolve a
 * base inalterada (clamp 0–10).
 */
export function computeMoodAdjusted(works: MoodWork[], mood: MoodRefine): Map<string, number | null> {
  const fit = computeMoodFit(works, mood)
  const out = new Map<string, number | null>()

  const rankable = works.filter((w) => w.decisionScore != null)
  const fits = rankable.map((w) => fit.get(w.id)).filter((f): f is number => f != null)
  const meanFit = fits.length > 0 ? fits.reduce((s, f) => s + f, 0) / fits.length : 0.5

  for (const w of works) {
    if (w.decisionScore == null) {
      out.set(w.id, null)
      continue
    }
    const f = fit.get(w.id)
    if (f == null) {
      out.set(w.id, w.decisionScore) // mood vazio → base
      continue
    }
    const adjusted = w.decisionScore + MOOD_SWING * (f - meanFit)
    out.set(w.id, Math.max(0, Math.min(10, adjusted)))
  }
  return out
}

/**
 * Ordena os `works` pela Prioridade ajustada ao mood (desc). Obras sem base vão
 * pro fim. Estável (preserva ordem de entrada em empates).
 */
export function sortByMoodAdjusted(works: MoodWork[], mood: MoodRefine): MoodWork[] {
  const adjusted = computeMoodAdjusted(works, mood)
  return [...works].sort((a, b) => {
    const av = adjusted.get(a.id)
    const bv = adjusted.get(b.id)
    return (bv ?? -Infinity) - (av ?? -Infinity)
  })
}
