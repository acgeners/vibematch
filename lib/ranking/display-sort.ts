import { roundToDisplayScore } from "@/lib/score-rounding"

/**
 * Notas 0–10 que a TELA imprime com UMA casa — e que por isso ordenam, bandam e
 * empatam pelo número exibido, nunca pelo decimal cru.
 *
 * 🔴 Existe porque a régua estava ESCRITA DUAS VEZES e as duas cópias divergiram.
 * `compareByField` (server/queries/ranking.ts) arredondava `expected_score`,
 * `recommended` e `user_score`, mas comparava `decision` pelo cru; e a chave da
 * banda (`ranking-table.tsx`) repetia a decisão num ternário próprio. Duas listas
 * do mesmo fato, mantidas à mão, e nada que as fizesse concordar.
 *
 * O que a divergência produzia, medido em 2026-08-15 no clone local (975 obras
 * ativas com Prioridade):
 *
 * | ordenando por Prioridade | pares empatados |
 * |---|---|
 * | pelo decimal cru (como era) | **229** |
 * | pela nota exibida (`~8,4`) | **19.624** |
 *
 * Ou seja: o 2º nível de ordenação escolhido pela pessoa — Média externa, Votos,
 * Veredito — e o desempate final por overlap de tags praticamente NUNCA entravam,
 * porque a ordem já tinha sido decidida por um decimal que ninguém vê. E o tooltip
 * da própria célula prometia o contrário ("dentro de cada faixa a ordem usa
 * compatibilidade e desempates, não o decimal"): a tela afirmando uma coisa e a
 * ordenação fazendo outra.
 *
 * ⚠️ Ao adicionar campo aqui, confira que a célula dele imprime 1 casa. Campo cuja
 * tela mostra o valor cru (percentil, votos, Veredito 0–100) NÃO entra: ali o
 * número exibido JÁ é o comparado.
 */
export const DISPLAY_ROUNDED_SORT_FIELDS = [
  "expected_score",
  "recommended",
  "user_score",
  "decision",
] as const

export type DisplayRoundedSortField = (typeof DISPLAY_ROUNDED_SORT_FIELDS)[number]

export function isDisplayRoundedSortField(field: string): field is DisplayRoundedSortField {
  return (DISPLAY_ROUNDED_SORT_FIELDS as readonly string[]).includes(field)
}

/**
 * Valor de ORDENAÇÃO: a nota como a tela a imprime. Ausente vira `-Infinity` —
 * em `desc` isso manda as sem-nota pro fim, que é o certo ("não sei" não disputa
 * as primeiras posições).
 */
export function displaySortValue(value: number | null | undefined): number {
  return value == null ? -Infinity : roundToDisplayScore(value)
}

/**
 * Chave da BANDA de tier. Mesmo arredondamento da ordenação — é essa igualdade que
 * `buildRankingTiers` exige no docstring dele: bandar por uma chave e ordenar por
 * outra faz o mesmo tier reaparecer em vários blocos "Tier N", sem erro nenhum.
 *
 * ⚠️ Devolve `null` (e não `-Infinity`) para ausente porque `buildRankingTiers`
 * junta os inválidos num último tier próprio — `-Infinity` viraria uma banda de
 * verdade lá embaixo.
 */
export function displayTierKey(value: number | null | undefined): number | null {
  return value == null ? null : roundToDisplayScore(value)
}
