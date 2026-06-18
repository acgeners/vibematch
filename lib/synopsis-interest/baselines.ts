/**
 * Baselines DETERMINÍSTICOS de Interesse na Sinopse (Plano 3 Fase B). PUROS.
 *
 * D1 — só TAGS: reaproveita o overlap ponderado por strength (personal-fit).
 *      Mede o teto sem olhar a prosa da sinopse.
 * D2 — TAGS + KEYWORDS da sinopse: D1 + análise determinística do TEXTO
 *      (temas amados/evitados, negação, placeholders, truncamento, promo,
 *      pouco-informativo, cobertura temática). SEM embeddings.
 *
 * Thresholds e pesos são FIXOS, escolhidos por raciocínio — NÃO ajustados nos
 * golden labels. Logo, NÃO exigem OOF (plano §6). Se algum dia forem calibrados
 * nos labels, passa a exigir OOF/holdout.
 *
 * D1 NÃO é descartável mesmo se D2 ganhar: ele mede o ganho incremental do texto.
 */

import { weightedTagOverlap } from "@/lib/ai-recommendation/personal-fit"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
import { levelToQuality } from "./metrics"
import type { SynopsisQuality } from "@/types/domain"

export interface BaselineWork {
  tags: Array<{ name: string; group: string | null }>
  synopsis: string | null
}

export interface BaselineResult {
  level: number
  quality: SynopsisQuality
  /** Score contínuo [0,1] pré-threshold — usado em pairwise/ranking. */
  score: number
  signals: Record<string, number>
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Thresholds FIXOS sobre [0,1]: <t1→♥, <t2→♥♥, <t3→♥♥♥, ≥t3→♥♥♥♥. */
const THRESHOLDS = { t1: 0.15, t2: 0.38, t3: 0.62 } as const

function scoreToLevel(score: number): number {
  if (score < THRESHOLDS.t1) return 1
  if (score < THRESHOLDS.t2) return 2
  if (score < THRESHOLDS.t3) return 3
  return 4
}

function sumStrength(tags: TasteProfilePayload["loved_tags"]): number {
  return tags.reduce((a, t) => a + clamp01(t.strength), 0)
}

/** Razão de alinhamento de tags normalizada [0,1] (replica tagAlignment). */
function tagAlignmentScore(work: BaselineWork, profile: TasteProfilePayload): number {
  const lovedMax = sumStrength(profile.loved_tags)
  const avoidedMax = sumStrength(profile.avoided_tags)
  const lovedScore = weightedTagOverlap(work.tags, profile.loved_tags) ?? 0
  const avoidedScore = weightedTagOverlap(work.tags, profile.avoided_tags) ?? 0
  const lovedRatio = lovedMax > 0 ? lovedScore / lovedMax : 0
  const avoidedRatio = avoidedMax > 0 ? avoidedScore / avoidedMax : 0
  return clamp01(lovedRatio - 1.5 * avoidedRatio + (lovedMax === 0 ? 0.5 : 0))
}

// ── D1 — tags only ───────────────────────────────────────────────────────────

export function baselineD1(work: BaselineWork, profile: TasteProfilePayload): BaselineResult {
  const score = tagAlignmentScore(work, profile)
  return { level: scoreToLevel(score), quality: levelToQuality(scoreToLevel(score)), score, signals: { tagAlignment: score } }
}

// ── D2 — tags + synopsis keywords ────────────────────────────────────────────

const PLACEHOLDER_RE = /\b(?:sinopse|descri[cç][aã]o)\s+(?:indispon[ií]vel|em breve)|no description|coming soon|\btbd\b|n\/a|sem sinopse/i
const PROMO_RE = /\b(?:dispon[ií]vel (?:agora|em)|buy now|pre-?order|read (?:now|it) on|leia (?:agora|j[aá]))\b|https?:\/\//i
const NEGATION_RE = /\b(?:no|not|without|sem|n[aã]o|nenhum[ao]?)\b/i

function tokenize(text: string): { tokens: Set<string>; lower: string } {
  const lower = text.toLowerCase()
  const tokens = new Set(lower.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean))
  return { tokens, lower }
}

/** Um tema/tag "aparece" se TODAS as suas palavras significativas estão nos tokens. */
function phraseHits(phrase: string, tokens: Set<string>): boolean {
  const words = phrase.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2)
  if (words.length === 0) return false
  return words.every((w) => tokens.has(w))
}

/** Conta hits de uma lista de frases nos tokens, com checagem de negação no texto. */
function countThemeHits(phrases: string[], tokens: Set<string>, lower: string, checkNegation: boolean): number {
  let hits = 0
  for (const p of phrases) {
    if (!phraseHits(p, tokens)) continue
    if (checkNegation) {
      // janela curta antes da 1ª palavra do tema: se houver negação, descarta o hit.
      const w0 = p.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)[0]
      if (w0) {
        const idx = lower.indexOf(w0)
        const window = idx > 0 ? lower.slice(Math.max(0, idx - 24), idx) : ""
        if (NEGATION_RE.test(window)) continue
      }
    }
    hits += 1
  }
  return hits
}

export function baselineD2(work: BaselineWork, profile: TasteProfilePayload): BaselineResult {
  const base = tagAlignmentScore(work, profile)
  const synopsis = (work.synopsis ?? "").trim()
  const signals: Record<string, number> = { tagAlignment: base }

  // Pouco-informativo: sinopse curta/placeholder domina pra baixo.
  if (synopsis.length < 40 || PLACEHOLDER_RE.test(synopsis)) {
    const score = Math.min(base, 0.12)
    signals.lowInfo = 1
    return { level: scoreToLevel(score), quality: levelToQuality(scoreToLevel(score)), score, signals }
  }

  const { tokens, lower } = tokenize(synopsis)
  const lovedThemes = profile.loved_themes ?? []
  const avoidedThemes = profile.avoided_themes ?? []
  const lovedTagNames = profile.loved_tags.map((t) => t.name)
  const avoidedTagNames = profile.avoided_tags.map((t) => t.name)

  const lovedHits = countThemeHits([...lovedThemes, ...lovedTagNames], tokens, lower, false)
  const avoidedHits = countThemeHits([...avoidedThemes, ...avoidedTagNames], tokens, lower, true)
  const lovedDen = Math.max(1, lovedThemes.length + lovedTagNames.length)
  const coverage = Math.min(1, lovedHits / Math.max(3, Math.min(8, lovedDen))) // saturação suave

  // Penalidades textuais (pouco-informativo brando / promo / truncamento).
  let penalty = 0
  if (PROMO_RE.test(synopsis)) penalty += 0.1
  if (/\.\.\.$|…$/.test(synopsis) || /\b\w-$/.test(synopsis)) penalty += 0.05
  if (synopsis.length < 120) penalty += 0.05

  // Combinação (pesos FIXOS): texto reforça/contradiz o sinal de tags.
  const textBoost = 0.18 * coverage
  const textDrop = 0.16 * Math.min(1, avoidedHits / 2)
  const score = clamp01(base + textBoost - textDrop - penalty)

  signals.lovedHits = lovedHits
  signals.avoidedHits = avoidedHits
  signals.coverage = coverage
  signals.penalty = penalty
  signals.textBoost = textBoost
  signals.textDrop = textDrop
  return { level: scoreToLevel(score), quality: levelToQuality(scoreToLevel(score)), score, signals }
}
