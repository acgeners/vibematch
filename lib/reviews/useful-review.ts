/**
 * Regra ÚNICA de "review útil" — compartilhada por summary/digest (gates de
 * orquestração) e pela aba diagnóstica "Sem reviews". PURO.
 *
 * Uma review é "útil" quando seu texto tem ≥ MIN_USEFUL_REVIEW_LENGTH chars
 * (após trim). Reviews vazias/curtíssimas (1–2 palavras) NÃO contam — espelha o
 * filtro de `lib/orchestration/integrations/reviews.ts` (summary/digest).
 */

export const MIN_USEFUL_REVIEW_LENGTH = 40

/** Regra canônica (texto). Usada pelos gates de summary/digest. */
export function isUsefulReviewText(text: string | null | undefined): boolean {
  return (text ?? "").trim().length >= MIN_USEFUL_REVIEW_LENGTH
}

/**
 * Proxy BARATO por `work_reviews.text_length` (comprimento bruto persistido) —
 * para classificação em massa sem carregar o texto. Difere de `isUsefulReviewText`
 * só por espaços nas pontas (text_length é o comprimento bruto); para "tem ≥1
 * review útil?" a diferença é desprezível.
 */
export function isUsefulReviewLength(textLength: number | null | undefined): boolean {
  return (textLength ?? 0) >= MIN_USEFUL_REVIEW_LENGTH
}
