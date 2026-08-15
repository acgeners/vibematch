/**
 * Helpers de alinhamento determinístico entre o TasteProfile e uma obra.
 *
 * 🔴 **Quem calcula o "Alinhamento" da UI NÃO é este arquivo inteiro — é só o
 * `netNameOverlap`.** O `personal_fit` persistido sai de
 * `server/actions/calculations.ts` (bloco 5): `netNameOverlap` → min-max sobre o
 * catálogo → percentil midrank (`personal_fit_percentile`, o número da tela).
 * Critério NÃO entra no Alinhamento; `criterionAlignment` e `weightedTagOverlap`
 * viraram FEATURES do Ridge da Nota Prevista (bloco 2b do mesmo arquivo).
 *
 * ⚠️ **`computePersonalFit` (0.4 tag + 0.3 critério + 0.3 consistência) foi
 * REMOVIDA em 15/08/2026**, com `tagAlignment` e `profileConsistency`, que só ela
 * usava. Estava morta desde 2026-06-27, aposentada por medição (bootstrap de
 * acc-par intra-tier: ~0.474 para ela, ABAIXO do acaso, contra ~0.544 do
 * `netNameOverlap` por nome).
 *
 * 🔴 **Ela sobreviveu 5 semanas depois de três auditorias mandarem apagá-la
 * (`AUDIT_REPORT-2026-07-08` C3, `STATUS-UNIFICADO-2026-07-11` O3,
 * `DIAGNOSTICO-DADOS-E-MELHORIAS` R2), e o custo apareceu:** o docstring deste
 * arquivo e o tooltip do `/ranking` descreviam a fórmula DELA como se fosse a
 * vigente. Código morto não fica inerte — ele continua sendo lido como
 * documentação, e é mais convincente que documentação, porque compila.
 * Não a ressuscite sem refazer a medição.
 *
 * ⚠️ **Consequência do `netName` ser SOMA sem denominador:** o nº de tags é o teto
 * de quantas amadas a obra pode encostar, então obra sub-tagueada tem Alinhamento
 * estruturalmente baixo. Medido em 15/08/2026 nas 988 obras: percentil médio 8,5
 * (≤10 tags) → 80,8 (100+), Spearman +0,584. Normalizar por nº de tags foi testado
 * em 03/07/2026 e PIORA (−0,040, IC exclui zero): o volume carrega sinal real.
 * A ressalva vive na UI (ver `AlignmentTooltipContent`), não na fórmula.
 */

import type { CategoryScoreMap, CriterionSlug } from "@/types/domain"
import type { ProfileTag, TasteProfilePayload } from "./types"

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


function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

