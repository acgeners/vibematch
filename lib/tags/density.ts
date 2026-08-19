/**
 * Densidade de tags de uma obra: quanto do que ela É bate com o seu gosto.
 *
 * O comparador mostrava só os chips, e a única contagem que dava pra fazer de
 * olho era ABSOLUTA — que é, medido, quase a mesma coisa que "quantas tags a
 * obra tem". No clone local (978 obras, 2026-08-18): corr(nº de tags, nº de
 * amadas) = **+0,80**, contra **−0,40** entre nº de tags e a PROPORÇÃO de
 * amadas. Caso real: `Elissa's Whirlwind Marriage` tem 65 tags amadas (o
 * recorde do catálogo) e isso é 25% dela; `Villainess in Love` tem 45 em 80 =
 * 56%. Lado a lado, as duas mostravam cinco chips verdes iguais.
 *
 * 🔴 Isto é COBERTURA, não previsão de gosto — não confundir com o Alinhamento
 * (`personal_fit`), que é a soma sem denominador. Normalizar AQUELE número por
 * nº de tags já foi medido e REPROVADO (`net/nTags` piora a acc-par em −0,040,
 * IC excluindo zero, 03/07/2026): o volume de tags carrega sinal real. O que
 * esta densidade responde é outra pergunta — "de tudo que descreve esta obra,
 * que fatia é gosto meu?" —, e ela existe pra ser comparada ENTRE obras de
 * tamanhos diferentes, não pra ordenar o catálogo por gosto.
 */

import { lowercasedNameSet, segmentTags } from "./segment"
import type { SegmentedTags, TagStanceInfo } from "./segment"

export interface TagDensity {
  /** Denominador: tags consideradas (amadas + evitadas + resto), SEM os gêneros. */
  total: number
  loved: number
  avoided: number
  /** 0–100. `null` quando a obra não tem tag nenhuma — nunca 0, que afirmaria "nada bate". */
  lovedPct: number | null
  avoidedPct: number | null
}

export interface WorkTagBreakdown<T> extends SegmentedTags<T> {
  density: TagDensity
}

/**
 * Segmentação + densidade numa passada só. É o DONO das duas: a nuvem de chips e
 * o resumo em % saem do MESMO objeto, então o denominador não tem como divergir
 * do que a célula desenha. Duas chamadas a `segmentTags` com `excludeNames`
 * diferentes seriam dois critérios pro mesmo fato, com o lado visível sendo o
 * errado.
 *
 * ⚠️ Gênero fica FORA do denominador: ele não tem stance (ninguém declara
 * "amo Romance" em `user_tag_preferences`), e somá-lo só diluiria o % de todo
 * mundo — proporcionalmente ao que a obra tem de gênero, não ao que ela tem de
 * gosto.
 */
export function describeWorkTags<T extends { name: string }>(
  genres: ReadonlyArray<string>,
  tags: ReadonlyArray<T>,
  getStance: (t: T) => TagStanceInfo | null,
): WorkTagBreakdown<T> {
  const segmented = segmentTags(tags, getStance, lowercasedNameSet(genres))
  return { ...segmented, density: tagDensity(segmented) }
}

/** Deriva a densidade de uma segmentação já feita — nunca conte as tags de novo. */
export function tagDensity(seg: SegmentedTags<unknown>): TagDensity {
  const loved = seg.loved.length
  const avoided = seg.avoided.length
  const total = loved + avoided + seg.rest.length
  const pct = (n: number) => (total === 0 ? null : (100 * n) / total)
  return { total, loved, avoided, lovedPct: pct(loved), avoidedPct: pct(avoided) }
}

/**
 * Fatia em texto, inteira.
 *
 * ⚠️ O ramo `<1%` não é preciosismo: a menor fatia não-nula do catálogo é
 * **1 tag em 261 = 0,38%**, e arredondá-la pra "0%" imprimiria "não tem
 * nenhuma" ao lado de um segmento de barra visível — a tela se contradizendo
 * em dois centímetros.
 */
export function formatTagShare(pct: number | null): string {
  if (pct == null) return "—"
  if (pct > 0 && pct < 0.5) return "<1%"
  return `${Math.round(pct)}%`
}
