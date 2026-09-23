import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"

/**
 * Os critérios que o LEITOR vê. Hoje = os 11 de `CRITERION_SLUGS`, sem exceção.
 *
 * 🔴 ESTA LISTA FICOU VAZIA, E ISSO É O CONSERTO — não um descuido. Até a migration 198,
 * `fantasy_nobility` estava em `CRITERION_SLUGS` (era critério de IA) e precisava ser escondido
 * aqui: é um construto MISTO, medido na etapa 56 da auditoria — r(fantasia, nobreza) = 0,118, e
 * das 839 obras com nota >= 7, 48,3% são só nobreza, 8,3% só fantasia, 21,1% ambas e 22,3% nem
 * uma nem outra. A mesma nota significava quatro coisas.
 *
 * A 198 tirou `fantasy_nobility` e `nobility` de `eval_type='IA'`, então os dois deixaram de
 * entrar em `CRITERION_SLUGS` e não há mais o que filtrar: quem os removia agora é a origem.
 *
 * ⚠️ O módulo CONTINUA existindo, e não por inércia. `isLegacyHiddenCriterion` é consultada por
 * telas de CURADORIA e por leitores de preset/URL antigos, que ainda encontram os dois slugs em
 * dado histórico — `category_scores` e `ai_evaluation_scores` seguem intactos. Apagar a régua
 * faria um `min_fantasy_nobility` guardado em 2026-08 voltar a pintar coluna para o leitor.
 */
export const LEGACY_HIDDEN_SLUGS = ["fantasy_nobility", "nobility"] as const
export type LegacyHiddenSlug = (typeof LEGACY_HIDDEN_SLUGS)[number]

const OCULTOS = new Set<string>(LEGACY_HIDDEN_SLUGS)

/** Os critérios visíveis ao leitor, na ordem canônica. */
export const VISIBLE_CRITERION_SLUGS = CRITERION_SLUGS.filter(
  (slug): slug is Exclude<CriterionSlug, LegacyHiddenSlug & CriterionSlug> => !OCULTOS.has(slug),
)

/** `true` quando o critério é legado e não deve aparecer para quem só LÊ. */
export function isLegacyHiddenCriterion(slug: string): boolean {
  return OCULTOS.has(slug)
}
