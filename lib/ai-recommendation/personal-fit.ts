/**
 * personal_fit — alinhamento determinístico (0–1) entre o TasteProfile
 * atual e uma obra.
 *
 * Componentes (pesos somam 1):
 *   0.4 × tag_alignment      — jaccard ponderado por strength entre tags
 *                              da obra e loved/avoided do perfil
 *   0.3 × criterion_alignment — quão dentro das faixas ideais os
 *                              category_scores caem, ponderado por weight
 *   0.3 × profile_consistency — fração das tags da obra que são "amadas"
 *                              (sinal complementar à overlap pura)
 *
 * Retorna `null` quando o perfil é stub, sem loved/avoided e sem
 * criterion_preferences — não há sinal para computar.
 */

import type { CategoryScoreMap, CriterionSlug } from "@/types/domain"
import type { ProfileTag, TasteProfilePayload } from "./types"

export interface PersonalFitInputs {
  tags: Array<{ name: string; group: string | null }>
  categoryScores: CategoryScoreMap
}

const W_TAG = 0.4
const W_CRITERION = 0.3
const W_CONSISTENCY = 0.3

function tagKey(t: { name: string; group: string | null }): string {
  return `${t.group ?? ""}::${t.name.toLowerCase().trim()}`
}

function profileTagKey(t: ProfileTag): string {
  return `${t.group ?? ""}::${t.name.toLowerCase().trim()}`
}

/**
 * Soma da `strength` das `profileTags` que aparecem nas `workTags`. Útil
 * como feature numérica pra modelos preditivos (Ridge) — magnitude bruta
 * carrega informação que normalizar destrói.
 *
 * Retorna 0 quando não há overlap; null quando `profileTags` está vazio
 * (sem sinal — diferente de "overlap zero").
 */
export function weightedTagOverlap(
  workTags: Array<{ name: string; group: string | null }>,
  profileTags: ProfileTag[],
): number | null {
  if (profileTags.length === 0) return null
  const workSet = new Set(workTags.map(tagKey))
  let total = 0
  for (const t of profileTags) {
    if (workSet.has(profileTagKey(t))) total += clamp01(t.strength)
  }
  return total
}

/**
 * Overlap líquido por NOME (ignora o grupo): Σ strength das loved presentes na
 * obra − 1.5 × Σ strength das avoided presentes. Casamento por nome (lowercase)
 * em vez de `group::name` — valida melhor o desempate intra-tier (bootstrap
 * 2026-06-27: ~0.544 vs personal_fit 0.474 / tag_overlap_net group::name 0.514).
 *
 * Retorna `null` quando o perfil não tem loved nem avoided (sem sinal).
 */
export function netNameOverlap(
  workTags: Array<{ name: string }>,
  loved: ProfileTag[],
  avoided: ProfileTag[],
): number | null {
  if (loved.length === 0 && avoided.length === 0) return null
  const work = new Set(workTags.map((t) => t.name.toLowerCase().trim()))
  let lovedScore = 0
  let avoidedScore = 0
  for (const t of loved) if (work.has(t.name.toLowerCase().trim())) lovedScore += clamp01(t.strength)
  for (const t of avoided) if (work.has(t.name.toLowerCase().trim())) avoidedScore += clamp01(t.strength)
  return lovedScore - 1.5 * avoidedScore
}

function tagAlignment(
  workTags: Array<{ name: string; group: string | null }>,
  loved: ProfileTag[],
  avoided: ProfileTag[],
): number | null {
  if (loved.length === 0 && avoided.length === 0) return null

  const workSet = new Set(workTags.map(tagKey))
  if (workSet.size === 0) return loved.length > 0 ? 0 : 0.5

  let lovedScore = 0
  let lovedMax = 0
  for (const t of loved) {
    const s = clamp01(t.strength)
    lovedMax += s
    if (workSet.has(profileTagKey(t))) lovedScore += s
  }

  let avoidedScore = 0
  let avoidedMax = 0
  for (const t of avoided) {
    const s = clamp01(t.strength)
    avoidedMax += s
    if (workSet.has(profileTagKey(t))) avoidedScore += s
  }

  const lovedRatio = lovedMax > 0 ? lovedScore / lovedMax : 0
  const avoidedRatio = avoidedMax > 0 ? avoidedScore / avoidedMax : 0

  // Loved adiciona valor; avoided derruba mais agressivamente (1.5×) porque
  // presença de uma tag evitada é sinal forte de desalinhamento.
  return clamp01(lovedRatio - 1.5 * avoidedRatio + (lovedMax === 0 ? 0.5 : 0))
}

/**
 * Quão dentro das faixas ideais do perfil os `category_scores` da obra
 * caem (0–1, ponderado por weight). Reutilizado como feature do Ridge
 * em `prediction.ts`.
 */
export function criterionAlignment(
  scores: CategoryScoreMap,
  prefs: TasteProfilePayload["criterion_preferences"],
): number | null {
  const entries = Object.entries(prefs) as Array<
    [CriterionSlug, NonNullable<TasteProfilePayload["criterion_preferences"][CriterionSlug]>]
  >
  if (entries.length === 0) return null

  let weightedSum = 0
  let weightTotal = 0

  for (const [slug, pref] of entries) {
    const score = scores[slug]
    if (score == null) continue
    const w = clamp01(pref.weight)
    if (w === 0) continue
    weightTotal += w

    const { ideal_min, ideal_max } = pref
    if (score >= ideal_min && score <= ideal_max) {
      weightedSum += w
      continue
    }
    // Distância até a borda mais próxima da faixa, normalizada por 5
    // (metade da escala). Cai linearmente até 0 quando a distância ≥ 5.
    const distance = score < ideal_min ? ideal_min - score : score - ideal_max
    const fit = Math.max(0, 1 - distance / 5)
    weightedSum += w * fit
  }

  if (weightTotal === 0) return null
  return clamp01(weightedSum / weightTotal)
}

function profileConsistency(
  workTags: Array<{ name: string; group: string | null }>,
  loved: ProfileTag[],
  avoided: ProfileTag[],
): number | null {
  if (workTags.length === 0) return null
  if (loved.length === 0 && avoided.length === 0) return null

  const lovedSet = new Set(loved.map(profileTagKey))
  const avoidedSet = new Set(avoided.map(profileTagKey))
  let lovedHits = 0
  let avoidedHits = 0
  for (const t of workTags) {
    const k = tagKey(t)
    if (lovedSet.has(k)) lovedHits += 1
    if (avoidedSet.has(k)) avoidedHits += 1
  }
  const denom = workTags.length
  return clamp01((lovedHits - avoidedHits) / denom + 0.5)
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Calcula personal_fit pra uma obra dada o perfil atual.
 *
 * Retorna `null` quando o perfil não traz sinal suficiente
 * (perfil stub ou perfil completo mas sem nenhum loved/avoided/prefs).
 */
export function computePersonalFit(
  profile: TasteProfilePayload,
  inputs: PersonalFitInputs,
): number | null {
  const tagAlign = tagAlignment(inputs.tags, profile.loved_tags, profile.avoided_tags)
  const critAlign = criterionAlignment(inputs.categoryScores, profile.criterion_preferences)
  const consistency = profileConsistency(inputs.tags, profile.loved_tags, profile.avoided_tags)

  const components: Array<{ value: number; weight: number }> = []
  if (tagAlign != null) components.push({ value: tagAlign, weight: W_TAG })
  if (critAlign != null) components.push({ value: critAlign, weight: W_CRITERION })
  if (consistency != null) components.push({ value: consistency, weight: W_CONSISTENCY })

  if (components.length === 0) return null

  const totalWeight = components.reduce((s, c) => s + c.weight, 0)
  const weightedSum = components.reduce((s, c) => s + c.value * c.weight, 0)
  return clamp01(weightedSum / totalWeight)
}
