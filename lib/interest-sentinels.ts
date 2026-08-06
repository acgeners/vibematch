/**
 * Sentinela do filtro de Interesse (`?synopsis_q=` manual e `?synopsis_pred=` previsão):
 * o único valor que NÃO é um ♥.
 *
 * Aparece na UI como o chip **"Outros"**, e no /ai-evaluation como "Não avaliada".
 */

/**
 * Sem valor: no manual, `user_work_state.synopsis_quality IS NULL`; na previsão,
 * nenhuma linha em `synopsis_quality_predictions` para o SEU `taste_profile`.
 *
 * O caso da previsão é o comum em multi-user, não a exceção: a previsão é de um
 * perfil de gosto, então **todo usuário novo enxerga o catálogo inteiro sem previsão**
 * até rodar o próprio perfil. Sem este filtro não havia como listar essas obras.
 */
export const INTEREST_NONE = "none"

/**
 * ⚠️ Token APOSENTADO (migration 179) — "Desconhecido", a proveniência
 * `synopsis_quality_source = 'legacy_unknown'`.
 *
 * Ele misturava duas coisas sem relação: 296 obras COM ♥ (histórico anterior à migration
 * 108, que carimbou o que já existia como "não inferir") e 133 SEM ♥ (só o default da
 * coluna). Hoje a regra é: ou tem ♥ ou não tem, e tendo, a origem só importa quando veio
 * da previsão da IA.
 *
 * A constante fica **só** para os leitores tolerarem o token em filtro salvo antigo —
 * ignorando-o, nunca casando por ele. Não use em código novo.
 */
export const INTEREST_UNKNOWN_RETIRED = "unknown"

/**
 * Remove da seleção os tokens que não existem mais, para que um `?synopsis_q=` gravado
 * antes da migration 179 abra como o filtro equivalente de hoje em vez de virar um
 * recorte que não casa nada.
 *
 * Devolve `undefined` quando não sobra nada — que é como os chamadores dizem "sem filtro"
 * (uma lista VAZIA significaria "nenhuma obra casa", que é o oposto).
 */
export function sanitizeInterestSelection(values?: string[]): string[] | undefined {
  if (!values?.length) return values
  const kept = values.filter((v) => v !== INTEREST_UNKNOWN_RETIRED)
  return kept.length ? kept : undefined
}

/**
 * A obra casa com a seleção de Interesse manual?
 *
 * Duas cláusulas em OU: o ♥ escolhido, ou a ausência de ♥ (chip "Outros").
 */
export function matchesManualInterest(
  work: { synopsisQuality: string | null },
  selected: ReadonlySet<string>,
): boolean {
  if (work.synopsisQuality != null && selected.has(work.synopsisQuality)) return true
  return selected.has(INTEREST_NONE) && work.synopsisQuality == null
}

/**
 * A obra casa com a seleção de Previsão da IA?
 *
 * Mesma forma do manual: o ♥ previsto, ou a ausência de previsão para o perfil de quem olha.
 */
export function matchesPredictedInterest(
  work: { predictedSynopsisQuality: string | null },
  selected: ReadonlySet<string>,
): boolean {
  if (work.predictedSynopsisQuality != null && selected.has(work.predictedSynopsisQuality)) {
    return true
  }
  return selected.has(INTEREST_NONE) && work.predictedSynopsisQuality == null
}
