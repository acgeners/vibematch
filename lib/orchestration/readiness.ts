/**
 * Resolver PURO de readiness por data key (Fase B passo 1) — ver
 * ARQUITETURA-ORQUESTRACAO.md §3/§4.
 *
 * Decisão D1: readiness é DERIVADO das colunas que já existem (não persistido).
 * Para manter o módulo puro e testável, o resolver opera sobre um SNAPSHOT
 * explícito (present/stale/contagens) — NÃO lê o banco. O loader que monta o
 * snapshot a partir das colunas reais é responsabilidade da fase de INTEGRAÇÃO
 * (deliberadamente fora deste passo, que entrega só a infra).
 *
 * `stale` nunca é inferido só de `null` — vem da assinatura correspondente
 * (`*_inputs_hash`, `*_version`, flag `stale`, `recalc_pending`), que o loader
 * compara e materializa no snapshot.
 */

import type { ContractPreconditionSnapshot, DataKey } from "./contracts"

export type DataReadiness = "absent" | "fresh" | "stale" | "partial"

export interface PresentStale {
  present: boolean
  stale: boolean
}

export interface WorkReadinessSnapshot {
  hasWorkRow: boolean
  rawSynopsisCount: number
  canonical: PresentStale
  tagsCount: number
  /** Tags da obra ainda sem grupo (tag_group_id = null) — enriquecimento pendente. */
  tagsUnenrichedCount: number
  externalIdsAcceptedCount: number
  platformRatingsCount: number
  reviewsCount: number
  summary: PresentStale
  digest: PresentStale
  tasteProfile: { present: boolean; isStub: boolean; stale: boolean }
  /** Obras com user_score na biblioteca (pré-condição do perfil). Global, não por obra. */
  ratedWorksCount: number
  /** Nº de category_scores de origem IA (9 = completo). */
  categoryScoresAiCount: number
  /** stale = formula_config.recalc_pending. */
  scores: PresentStale
  interest: PresentStale
}

function fromPresentStale(ps: PresentStale): DataReadiness {
  if (!ps.present) return "absent"
  return ps.stale ? "stale" : "fresh"
}

/**
 * Snapshot neutro (tudo ausente) — base para testes e para o loader montar por
 * cima sem esquecer campo.
 */
export function emptyReadinessSnapshot(): WorkReadinessSnapshot {
  return {
    hasWorkRow: false,
    rawSynopsisCount: 0,
    canonical: { present: false, stale: false },
    tagsCount: 0,
    tagsUnenrichedCount: 0,
    externalIdsAcceptedCount: 0,
    platformRatingsCount: 0,
    reviewsCount: 0,
    summary: { present: false, stale: false },
    digest: { present: false, stale: false },
    tasteProfile: { present: false, isStub: false, stale: false },
    ratedWorksCount: 0,
    categoryScoresAiCount: 0,
    scores: { present: false, stale: false },
    interest: { present: false, stale: false },
  }
}

/** Readiness por data key, derivado do snapshot. Função pura. */
export function resolveReadiness(s: WorkReadinessSnapshot): Record<DataKey, DataReadiness> {
  return {
    work_row: s.hasWorkRow ? "fresh" : "absent",
    raw_synopsis: s.rawSynopsisCount > 0 ? "fresh" : "absent",
    canonical_synopsis: fromPresentStale(s.canonical),
    tags: s.tagsCount > 0 ? "fresh" : "absent",
    tags_enriched:
      s.tagsCount === 0 ? "absent" : s.tagsUnenrichedCount > 0 ? "partial" : "fresh",
    external_ids_accepted: s.externalIdsAcceptedCount > 0 ? "fresh" : "absent",
    platform_ratings: s.platformRatingsCount > 0 ? "fresh" : "absent",
    reviews: s.reviewsCount > 0 ? "fresh" : "absent",
    review_summary: fromPresentStale(s.summary),
    review_digest: fromPresentStale(s.digest),
    taste_profile: !s.tasteProfile.present
      ? "absent"
      : s.tasteProfile.isStub
        ? "partial"
        : s.tasteProfile.stale
          ? "stale"
          : "fresh",
    category_scores_ai:
      s.categoryScoresAiCount >= 9 ? "fresh" : s.categoryScoresAiCount > 0 ? "partial" : "absent",
    calculated_scores: fromPresentStale(s.scores),
    interest_prediction: fromPresentStale(s.interest),
  }
}

/** Projeção do snapshot para as pré-condições dos contratos (sem acoplar tipos). */
export function toPreconditionSnapshot(s: WorkReadinessSnapshot): ContractPreconditionSnapshot {
  return {
    ratedWorksCount: s.ratedWorksCount,
    rawSynopsisCount: s.rawSynopsisCount,
    canonicalPresent: s.canonical.present,
  }
}
