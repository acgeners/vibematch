/**
 * Os filtros de ESTADO da aba "IA Atributos" (`/curation/works`) — num lugar só.
 *
 * 🔴 Eram duas cópias, e divergiram: a página (`ALL_FILTERS` + `DEFAULT_FILTERS`) e o
 * painel (`ai-evaluation-filters.tsx`). Em 2026-08-19 o default da PÁGINA ganhou
 * `outdated-reviews` e o painel ficou com o antigo `["pending","review-pending"]`. Dois
 * efeitos, os dois calados:
 *
 * - o painel contava o padrão como filtro ligado ("Filtros 3" com nada mexido);
 * - aplicar exatamente "Sem avaliação + Aguardando revisão" APAGAVA o `filter` da URL,
 *   porque o painel achava que aquilo era o padrão — a página caía no default DELA e a
 *   lista voltava às ~490 obras de reavaliação. Justo o recorte que explica o badge.
 *
 * Quem lê a URL (`parseAttrEvalFilters`) e quem a escreve (`isDefaultAttrEvalFilterSet`)
 * agora saem da mesma constante.
 */

export const ATTR_EVAL_FILTERS = [
  "pending",
  "review-pending",
  "low-confidence",
  "outdated-model",
  "outdated-reviews",
] as const
export type AttrEvalFilter = (typeof ATTR_EVAL_FILTERS)[number]

/**
 * 🔴 **A aba abria VAZIA, e era a causa nº 1 de ela não ser usada.** O default era
 * `["pending","review-pending"]`; contado na NUVEM em 2026-08-19, esses dois filtros
 * dão **0 e 0** — o catálogo está construído, e o trabalho que existe hoje é
 * REAVALIAÇÃO: `outdated-reviews` são **556 obras**. A tela abria zerada e só quem
 * sabia trocar o filtro à mão encontrava alguma coisa.
 *
 * ⚠️ `outdated-model` (929 no clone) fica FORA do default de propósito: ele traz quase
 * o catálogo inteiro — 9 versões de prompt convivem hoje —, e uma fila que é "tudo"
 * não é fila. `outdated-reviews` tem um gatilho por obra (chegou review nova) e é o
 * que a curadoria de fato persegue.
 *
 * ⚠️ O badge da Curadoria NÃO acompanha este default — ele conta `ATTR_DECISION_FILTERS`.
 */
export const DEFAULT_ATTR_EVAL_FILTERS: readonly AttrEvalFilter[] = [
  "pending",
  "review-pending",
  "outdated-reviews",
]

/**
 * O recorte que é "decisão esperando": nunca avaliada + avaliação aguardando revisão.
 *
 * É o que o badge da Curadoria conta (`getCuradoriaBadgeUnreadCount`) e o destino do
 * clique nele (`DECISION_QUEUES`). Por isso os dois DERIVAM daqui: com o filtro escrito
 * no link e os status escritos na query, um terceiro estado entrando no badge deixaria o
 * clique abrindo uma lista que não bate com o número.
 */
export const ATTR_DECISION_FILTERS = ["pending", "review-pending"] as const satisfies readonly AttrEvalFilter[]

/** O mesmo recorte em `works.ai_eval_status` (`review-pending` na URL ⇔ `review_pending` no banco). */
export const ATTR_DECISION_EVAL_STATUSES: readonly string[] = ATTR_DECISION_FILTERS.map((f) =>
  f.replace("-", "_"),
)

export function isDefaultAttrEvalFilterSet(filters: Iterable<AttrEvalFilter>): boolean {
  const set = new Set(filters)
  return set.size === DEFAULT_ATTR_EVAL_FILTERS.length && DEFAULT_ATTR_EVAL_FILTERS.every((f) => set.has(f))
}

/** `?filter=` → filtros válidos. Ausente ou só valores inválidos ⇒ o default. */
export function parseAttrEvalFilters(raw: string | string[] | undefined): AttrEvalFilter[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return [...DEFAULT_ATTR_EVAL_FILTERS]
  const valid = value
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is AttrEvalFilter => (ATTR_EVAL_FILTERS as readonly string[]).includes(p))
  return valid.length > 0 ? valid : [...DEFAULT_ATTR_EVAL_FILTERS]
}
