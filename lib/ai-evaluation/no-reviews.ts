/**
 * Motivos pelos quais uma avaliação IA roda "sem reviews externas", e os
 * rótulos/CTAs associados. Compartilhado entre o gate pré-análise (server
 * actions) e a UI de revisão para não duplicar as strings.
 */
export type NoReviewsReason =
  | "no_external_ids"
  | "all_rejected"
  | "search_miss"
  | "sources_returned_empty"

export const NO_REVIEWS_REASON_LABEL: Record<NoReviewsReason, string> = {
  no_external_ids: "obra ainda não foi linkada a fontes externas",
  all_rejected: "todas as fontes desta obra foram rejeitadas",
  search_miss: "busca por título não encontrou candidato confiável nas fontes",
  sources_returned_empty: "fontes linkadas existem, mas não devolveram reviews",
}

export const NO_REVIEWS_REASON_CTA: Record<NoReviewsReason, string | null> = {
  no_external_ids: "Atribuir fontes",
  all_rejected: "Revisar rejeições",
  search_miss: "Atribuir fontes",
  sources_returned_empty: null,
}

export function isNoReviewsReason(value: unknown): value is NoReviewsReason {
  return (
    value === "no_external_ids" ||
    value === "all_rejected" ||
    value === "search_miss" ||
    value === "sources_returned_empty"
  )
}
