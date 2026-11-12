import { isUsefulReviewText } from "@/lib/reviews/useful-review"

/**
 * Quantas reviews ÚTEIS uma obra precisa ter para a avaliação de atributos valer o gasto. PURO
 * (o diálogo de criação e a fila de `/curation/works` importam daqui).
 *
 * ## O número é MEDIDO (2026-11-12), e não é o do digest por herança
 *
 * Pares de avaliações seguidas da mesma obra, feitas com a MESMA régua (versão de prompt + modelo),
 * comparando a nota sugerida de cada critério. Reviews úteis contadas no que a avaliação leu
 * (`raw_response.evaluationContext.sourcedReviews`, texto ou trecho ≥ 40 caracteres):
 *
 * | 1ª avaliação → 2ª | pares | mudança média por nota | troca de faixa |
 * |---|---|---|---|
 * | menos de 4 úteis → 4 ou mais | 19 | **0,57** | **23,4%** |
 * | 4 a 9 → 10 ou mais | 7 | 0,30 | 9,5% |
 * | 10 ou mais nas duas (controle) | 38 | 0,22 | 9,9% |
 *
 * Bootstrap por PAR (as 9 notas de um par andam juntas): a diferença contra o controle é
 * +0,35 [0,21; 0,50] na mudança e +13,5 pontos [7,3; 19,9] na troca de faixa. Abaixo de 4, a
 * avaliação muda ~2,5× o ruído normal quando a obra ganha reviews; com 4 a 9 ela já se comporta
 * como o controle (só 7 pares — é o apoio mais fraco da tabela).
 *
 * ⚠️ "Muda mais" não prova "erra mais": a 2ª avaliação também viu a obra avançar. É o caso de obra
 * recém-lançada (21% das criadas nos 60 dias anteriores tinham menos de 4).
 *
 * ⚠️ Coincide com `MIN_USEFUL_REVIEWS_FOR_DIGEST` (`lib/reviews/digest-gate.ts`), mas são DOIS
 * fatos medidos separadamente (digest magro × avaliação instável). Mexer em um não mexe no outro.
 */
export const MIN_USEFUL_REVIEWS_FOR_EVAL = 4

/** Reviews úteis pela régua central (`isUsefulReviewText`, ≥ 40 caracteres). */
export function countUsefulReviews(reviews: ReadonlyArray<{ text?: string | null }>): number {
  return reviews.filter((r) => isUsefulReviewText(r.text)).length
}

export function hasEnoughReviewsForEval(usefulReviews: number): boolean {
  return usefulReviews >= MIN_USEFUL_REVIEWS_FOR_EVAL
}

/**
 * O filtro "Prontas para avaliar" da fila de atributos: das obras nunca avaliadas, as que já têm
 * reviews úteis suficientes. `usefulById` é o 💬 do card (`work_card_counts`) — o mesmo número que
 * a pessoa vê, para filtro e card nunca discordarem. Obra sem contagem conta como zero.
 */
export function selectReadyToEvaluate(
  pendingIds: readonly string[],
  usefulById: ReadonlyMap<string, number>,
): string[] {
  return pendingIds.filter((id) => hasEnoughReviewsForEval(usefulById.get(id) ?? 0))
}

/** O texto da pergunta da criação — um só, para o diálogo e o aviso de "adiada" concordarem. */
export function describeFewReviews(useful: number, total: number): string {
  const reviews = `${total} review${total === 1 ? "" : "s"}`
  const uteis = `${useful} ${useful === 1 ? "útil" : "úteis"}`
  return (
    `Esta obra tem ${reviews}, ${uteis} (texto com 40+ caracteres). Com menos de ` +
    `${MIN_USEFUL_REVIEWS_FOR_EVAL} reviews úteis, os atributos mudam cerca de 2,5× mais quando ` +
    `ela ganha reviews — e reavaliar custa de novo.`
  )
}
