import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"

/**
 * Os critérios que o LEITOR vê. Hoje = os 11 do banco menos o legado misto.
 *
 * 🔴 POR QUE `fantasy_nobility` SAI DA TELA. Ele é um construto MISTO, e isso foi medido
 * (auditoria, etapa 56): r(fantasia, nobreza) = 0,118 — eixos praticamente independentes — e das
 * 839 obras com nota >= 7, **48,3% são só nobreza, 8,3% só fantasia, 21,1% ambas e 22,3% nem uma
 * nem outra**. A mesma nota significa quatro coisas, então quem filtra por ">= 7" recebe os
 * quatro grupos misturados sem como distinguir. *Light and Shadow* tem 9,0 com ZERO tags de
 * magia; *The Spark in Your Eyes* tem 8,5 com ZERO nobreza.
 *
 * 🔴 POR QUE ELE NÃO É APAGADO. Ele continua em `SCORING_CRITERION_SLUGS` — alimenta o Ridge, a
 * Bússola, os embeddings e a guarda de `expected_score` —, continua sendo avaliado pelo provider
 * e continua editável na CURADORIA. Mostrá-lo ao lado de `fantasy` e `nobility` seriam três
 * afirmações sobre o mesmo assunto na mesma tela.
 *
 * ⚠️ A FRONTEIRA É LEITURA × CURADORIA, não "toda tela". Tirar o campo do `work-form` ou do
 * modal de revisão de IA deixaria sem manutenção o dado que ainda move a Nota Prevista — e o
 * `import.schema` passaria a recusar listas que trazem a coluna. Esses pontos mantêm o legado,
 * rotulado como tal.
 */
export const LEGACY_HIDDEN_SLUGS = ["fantasy_nobility"] as const
export type LegacyHiddenSlug = (typeof LEGACY_HIDDEN_SLUGS)[number]

const OCULTOS = new Set<string>(LEGACY_HIDDEN_SLUGS)

/** Os critérios visíveis ao leitor, na ordem canônica. */
export const VISIBLE_CRITERION_SLUGS = CRITERION_SLUGS.filter(
  (slug): slug is Exclude<CriterionSlug, LegacyHiddenSlug> => !OCULTOS.has(slug),
)

/** `true` quando o critério é legado e não deve aparecer para quem só LÊ. */
export function isLegacyHiddenCriterion(slug: string): boolean {
  return OCULTOS.has(slug)
}
