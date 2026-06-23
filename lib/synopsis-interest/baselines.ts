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

// Stopwords PT+EN — descartadas das frases de tema (não carregam sinal temático).
const STOPWORDS = new Set([
  "the", "of", "and", "with", "for", "to", "in", "by", "an", "a", "on", "her", "his", "its",
  "de", "da", "do", "das", "dos", "e", "em", "um", "uma", "que", "se", "na", "no", "com", "ao", "por",
])

function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
}

function tokenize(text: string): { tokens: Set<string>; lower: string } {
  const lower = text.toLowerCase()
  const tokens = new Set(normalizeWords(lower))
  return { tokens, lower }
}

/** Palavras significativas de uma frase (sem stopwords, len>2). */
function significantWords(phrase: string): string[] {
  return normalizeWords(phrase).filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** Uma palavra "casa" por token exato OU stem leve (prefixo de 5) p/ pegar flexões. */
function wordMatches(word: string, tokens: Set<string>): boolean {
  if (tokens.has(word)) return true
  if (word.length >= 5) {
    const stem = word.slice(0, 5)
    for (const t of tokens) if (t.length >= 5 && t.startsWith(stem)) return true
  }
  return false
}

/** Fração [0,1] das palavras significativas da frase presentes (parcial, não exata). */
function phraseMatchFraction(phrase: string, tokens: Set<string>): number {
  const words = significantWords(phrase)
  if (words.length === 0) return 0
  let m = 0
  for (const w of words) if (wordMatches(w, tokens)) m += 1
  return m / words.length
}

/** Há negação na janela curta antes da 1ª palavra significativa da frase? */
function isNegated(phrase: string, lower: string): boolean {
  const w0 = significantWords(phrase)[0]
  if (!w0) return false
  const idx = lower.indexOf(w0.slice(0, Math.min(5, w0.length)))
  if (idx <= 0) return false
  return NEGATION_RE.test(lower.slice(Math.max(0, idx - 28), idx))
}

/** Cobertura amada: SOMA das frações das frases (parcial conta). */
function lovedCoverageRaw(phrases: string[], tokens: Set<string>): number {
  let sum = 0
  for (const p of phrases) sum += phraseMatchFraction(p, tokens)
  return sum
}

/** Conta frases EVITADAS fortemente presentes (fração ≥ 0.5) e não-negadas. */
function avoidedStrongHits(phrases: string[], tokens: Set<string>, lower: string): number {
  let hits = 0
  for (const p of phrases) {
    if (phraseMatchFraction(p, tokens) >= 0.5 && !isNegated(p, lower)) hits += 1
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

  // Matching PARCIAL (palavra-a-palavra + stem leve): cobre frases multi-palavra
  // que não aparecem literais na sinopse (era o motivo de D2≡D1 antes).
  const lovedHits = lovedCoverageRaw([...lovedThemes, ...lovedTagNames], tokens)
  const avoidedHits = avoidedStrongHits([...avoidedThemes, ...avoidedTagNames], tokens, lower)
  // Saturação suave: ~3 frações somadas já dá cobertura plena.
  const coverage = Math.min(1, lovedHits / 3)

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
