/**
 * Quantas reviews ÚTEIS uma obra precisa ter para valer um digest. PURO.
 *
 * ## Por que existe um piso, e por que ele é 4
 *
 * Até 2026-08-14 o único piso era "≥1 review útil" (`classifyDigestReadiness`
 * devolvia `not_applicable` só com zero). Com 1 ou 2 reviews o modelo não tem
 * consenso pra destilar — ele produz um digest que PARECE um digest, e o
 * consultor IA (Recomendar / Veredito / Deep Dive / Chat) o consome como sinal.
 * Artefato ruim mente mais que artefato ausente.
 *
 * 🔴 **O número é MEDIDO, não escolhido.** Sobre os 846 digests na versão vigente
 * do clone local (2026-08-14), contando reviews pela MESMA régra que o digest usa
 * (`isUsefulReviewText`, ≥40 chars — a contagem CRUA dá outro joelho e levaria a
 * outro limiar), a taxa de "digest magro" — o modelo não alcançar os 3 traços que
 * o próprio prompt exige, que é estrutural e não interpretação de prosa:
 *
 * | reviews úteis | obras | digest magro |
 * |---|---|---|
 * | 1 | 4 | **75%** |
 * | 2 | 4 | **50%** |
 * | 3 | 4 | **25%** |
 * | **4** | 11 | **0%** |
 * | 5-6 | 28 | 0% |
 * | 7-19 | 165 | 0% |
 * | 20+ | 630 | 1-4% |
 *
 * ⚠️ **As faixas baixas têm 4 obras cada** — "25%" é UMA obra, e o intervalo de
 * confiança de 1/4 vai de ~1% a ~70%. O que os dados sustentam com força é que
 * **≥4 é limpo** (200+ obras, ~0%) e **≤2 é ruim**; o 3 é indistinguível de
 * qualquer um dos dois. Arredondar PRA CIMA é a escolha defensável, pela mesma
 * assimetria acima. 5 e 10 foram considerados e não têm apoio nenhum: nada muda
 * na faixa 4→9 além dos eixos distintos subirem de 5 pra 6.
 *
 * ⚠️ **O gate reduz o problema, não o elimina:** 20+ reviews ainda dá 1-4% de
 * digest magro. Contagem de review não é a única causa.
 *
 * ⚠️ Ao mexer no número, RE-MEÇA — não estime. O script da medição está descrito
 * acima: agrupar `works.review_digest` por contagem de review útil e contar
 * `salient_traits.length < 3`.
 */

export const MIN_USEFUL_REVIEWS_FOR_DIGEST = 4

/**
 * A régua, num lugar só.
 *
 * 🔴 São TRÊS consumidores e eles têm que concordar: o gate por obra
 * (`classifyDigestReadiness`), a fila da aba (`getReviewDigestQueue`) e o rótulo
 * do card. Uma comparação reescrita em qualquer um deles é como a aba mostra 107
 * obras elegíveis e o botão recusa uma delas.
 *
 * ⚠️ O LOTE (`generateDigestsForWorks`) NÃO está na lista de propósito: ele
 * delega a `ensureReviewDigest`, que já aplica o gate. Aplicar o piso lá seria
 * uma segunda opinião sobre o mesmo fato. Foi por não delegar que o lote antigo
 * do `/curation/settings` (`consolidatePendingReviewDigests`) foi aposentado em vez de
 * corrigido: ele tinha corpus próprio e nenhum gate.
 */
export function hasEnoughReviewsForDigest(usefulReviewCount: number): boolean {
  return usefulReviewCount >= MIN_USEFUL_REVIEWS_FOR_DIGEST
}

/**
 * Teto de obras por clique no lote da aba.
 *
 * ⚠️ Mora AQUI, e não na server action, por uma regra do Next: arquivo
 * `"use server"` só pode exportar função async — uma `export const` ali quebra o
 * módulo inteiro em runtime ("Only async functions are allowed to be exported"),
 * com `tsc` e a suíte de testes passando VERDES. Descoberto abrindo a página.
 *
 * 🔴 E não pode ser duplicado: o servidor corta a lista neste número e o popup de
 * custo ESTIMA por ele. Duas cópias divergindo é o modal prometer 40 obras e o
 * servidor rodar 10 — um número que mente pra mais numa confirmação de gasto.
 */
export const DIGEST_BATCH_MAX = 10
