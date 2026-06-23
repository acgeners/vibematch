/**
 * Assinatura de staleness ESPECÍFICA de Interesse na Sinopse (Plano 3 Fase B).
 * PURO (node:crypto + tipos). Experimental — NÃO altera o gate de staleness de
 * produção (computeProfileSignature continua intacto).
 *
 * Problema medido: cada regeneração do taste_profile que muda a assinatura ATUAL
 * (que inclui criterion_preferences + narrative_patterns) invalida TODAS as
 * previsões → re-backfill pago. Mas o INTERESSE NA SINOPSE depende basicamente de
 * tags/temas amados e evitados. Uma assinatura mais estreita evitaria invalidações
 * fúteis quando só mudaram preferências de critério (pós-leitura) ou padrões
 * narrativos que não afetam a triagem por sinopse.
 *
 * Risco a vigiar: se uma preferência REALMENTE relevante mudar mas não entrar na
 * assinatura estreita, reutilizaríamos uma previsão velha. Por isso a assinatura
 * candidata é validada (não trocada em produção) nesta fase.
 */

import { createHash } from "node:crypto"
import type { ProfileTag, TasteProfilePayload } from "@/lib/ai-recommendation/types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function sortTags(ts: ProfileTag[] | undefined): Array<{ n: string; g: string; s: number }> {
  return [...(ts ?? [])]
    .map((t) => ({ n: t.name, g: t.group ?? "", s: round2(t.strength) }))
    .sort((a, b) => `${a.g}::${a.n}`.localeCompare(`${b.g}::${b.n}`))
}

function sortStrs(ss: string[] | undefined): string[] {
  return [...(ss ?? [])].map((s) => s.trim()).sort((a, b) => a.localeCompare(b))
}

/**
 * Assinatura CANDIDATA: só os drivers de interesse na sinopse — tags e temas
 * amados/evitados. Exclui de propósito criterion_preferences (pós-leitura) e
 * narrative_patterns (não dominam a triagem por sinopse).
 */
export function relevantSynopsisSignature(profile: TasteProfilePayload): string {
  const canonical = JSON.stringify({
    lovedTags: sortTags(profile.loved_tags),
    avoidedTags: sortTags(profile.avoided_tags),
    lovedThemes: sortStrs(profile.loved_themes),
    avoidedThemes: sortStrs(profile.avoided_themes),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

export interface StalenessTransitionAnalysis {
  /** Nº de transições entre versões consecutivas analisadas. */
  transitions: number
  /** Transições em que a assinatura ATUAL (cheia) mudou (= invalidação hoje). */
  fullChanges: number
  /** Transições em que a assinatura CANDIDATA (estreita) mudou. */
  relevantChanges: number
  /** Cheia mudou mas a estreita NÃO → invalidações que seriam evitadas. */
  avoidedInvalidations: number
  /** avoidedInvalidations / fullChanges. */
  avoidedRate: number | null
}

/**
 * Compara, por transição de versão, se a assinatura cheia × estreita mudou.
 * `versions` deve vir em ordem cronológica. Puro.
 */
export function analyzeStalenessTransitions(
  versions: Array<{ fullSig: string; relevantSig: string }>,
): StalenessTransitionAnalysis {
  let fullChanges = 0
  let relevantChanges = 0
  let avoided = 0
  for (let i = 1; i < versions.length; i += 1) {
    const fullChanged = versions[i]!.fullSig !== versions[i - 1]!.fullSig
    const relevantChanged = versions[i]!.relevantSig !== versions[i - 1]!.relevantSig
    if (fullChanged) fullChanges += 1
    if (relevantChanged) relevantChanges += 1
    if (fullChanged && !relevantChanged) avoided += 1
  }
  return {
    transitions: Math.max(0, versions.length - 1),
    fullChanges,
    relevantChanges,
    avoidedInvalidations: avoided,
    avoidedRate: fullChanges > 0 ? avoided / fullChanges : null,
  }
}
