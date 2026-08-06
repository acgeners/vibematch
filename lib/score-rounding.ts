/**
 * Arredondamento de nota para a granularidade EXIBIDA (1 casa decimal).
 *
 * 🔴 Toda decisão que precisa concordar com o número na tela — ordenação, faixa de
 * cor, empate, limiar — tem que passar por aqui. O app exibe nota com
 * `value.toFixed(1)`, e o atalho intuitivo (`Math.round(value * 10) / 10`)
 * **discorda dele** em 40 dos 1.001 valores de 2 casas entre 0 e 10 (medido).
 *
 * A causa é a multiplicação: `value * 10` já é uma operação em ponto flutuante e
 * arredonda ANTES do `Math.round`. O double mais próximo de 8,35 é
 * 8,34999999999999964…; multiplicado por 10 o resultado exato (83,4999…) cai
 * dentro de meio ULP de 83.5 e vira **exatamente 83.5**, que o `Math.round` sobe
 * pra 84 → 8,4. Já `toFixed(1)` lê o valor exato do double e devolve "8,3".
 *
 * O sintoma nunca é um erro — é um número plausível no lugar errado:
 * - `/ranking` (medido 2026-08-06): "The Spark in Your Eyes" (8,35) ordenava como
 *   8,4 e **exibia 8,3**, aparecendo na 2ª posição à frente de dois 8,4 legítimos.
 * - `ScoreBadge`: 8,45 pegava a cor de 8,5 ("top") exibindo "8,4" — exatamente o
 *   "flip invisível na fronteira" que o arredondamento existia para evitar.
 */
export function roundToDisplayScore(value: number): number {
  return Number(value.toFixed(1))
}
