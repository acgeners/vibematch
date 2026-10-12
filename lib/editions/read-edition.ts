/**
 * A versão que a AVALIAÇÃO de uma obra `mixed` descreve — `user_work_state.read_edition` (mig 216).
 * Módulo PURO: dado o estado atual da linha e o que está sendo gravado, decide o que gravar na versão.
 *
 * Decisão de produto de 2026-10-12 (D1): UMA avaliação atual por pessoa + obra, com a versão registrada
 * nela. A versão vale para a avaliação INTEIRA (nota, nota rápida, pós-leitura, piloto) — não há
 * versões divergentes dentro dela. As regras:
 *   · avaliação NOVA (não havia nenhuma) ⇒ a versão EFETIVA do contexto: a ativa na tela da obra, ou,
 *     sem tela (lista, onboarding), a padrão da conta naquela obra;
 *   · avaliação EXISTENTE ⇒ a versão dela é PRESERVADA, inclusive quando é `null` (histórico de versão
 *     desconhecida): editar 8,0 → 8,5 não muda a versão nem a "descobre";
 *   · troca EXPLÍCITA ("Alterar") ⇒ a versão escolhida, e só ela muda;
 *   · dado de FORA (importação de lista) ⇒ versão desconhecida: a nota importada não diz o que se leu;
 *   · avaliação APAGADA inteira ⇒ a versão some junto;
 *   · escrita que não toca a avaliação (status, capítulos, favorito, interesse) ⇒ não mexe na versão;
 *   · obra não-mixed ⇒ não tem versão.
 */
import { parseMixedEdition } from "@/lib/editions/mixed-edition"
import type { MixedEdition } from "@/lib/editions/mixed-edition"

export const READ_EDITION_SOURCES = ["active_version", "user_choice", "explicit_user_decision"] as const
export type ReadEditionSource = (typeof READ_EDITION_SOURCES)[number]

/**
 * As colunas de `user_work_state` que compõem a AVALIAÇÃO (a nota, a nota rápida e as 8 de pós-leitura).
 * O piloto grava a `user_score` como rótulo, então passa por aqui também. Conferido contra
 * `POST_READING_COLUMNS` em teste — uma lista à mão divergiria em silêncio.
 */
export const EVALUATION_COLUMNS = [
  "user_score",
  "quick_score",
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

export type ReadEditionContext =
  /** A versão efetiva da tela da obra (padrão, URL ou troca pontual). */
  | { kind: "active"; edition: MixedEdition }
  /** A pessoa trocou a versão DA AVALIAÇÃO ("Alterar"). */
  | { kind: "explicit"; edition: MixedEdition }
  /** Sem tela de obra: a padrão da conta naquela obra. */
  | { kind: "default" }
  /** Dado de fora (importação): versão desconhecida. */
  | { kind: "unknown" }

export interface CurrentEvaluationRow {
  readEdition: MixedEdition | null
  /** Os valores atuais das colunas da avaliação. */
  values: Partial<Record<(typeof EVALUATION_COLUMNS)[number], unknown>>
}

export type ReadEditionWrite = { read_edition: MixedEdition | null; read_edition_source: ReadEditionSource | null }

function temAvaliacao(values: CurrentEvaluationRow["values"]): boolean {
  return EVALUATION_COLUMNS.some((c) => values[c] != null)
}

function sameScore(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  return Number(a) === Number(b)
}

/** O patch toca alguma coluna da avaliação? */
export function touchesEvaluation(patch: Record<string, unknown>): boolean {
  return EVALUATION_COLUMNS.some((c) => Object.prototype.hasOwnProperty.call(patch, c))
}

/**
 * O que gravar na versão desta linha — ou `null` para NÃO tocar nas duas colunas.
 * `defaultEdition` só é usado quando o contexto é `default` e a avaliação é nova.
 */
export function planReadEdition(input: {
  isMixed: boolean
  current: CurrentEvaluationRow | null
  patch: Record<string, unknown>
  context: ReadEditionContext
  defaultEdition: MixedEdition | null
}): ReadEditionWrite | null {
  const { isMixed, current, patch, context } = input
  if (!isMixed) return null
  const explicit = context.kind === "explicit"
  if (!touchesEvaluation(patch) && !explicit) return null

  const antes = current?.values ?? {}
  const depois = { ...antes } as Record<string, unknown>
  for (const c of EVALUATION_COLUMNS) if (Object.prototype.hasOwnProperty.call(patch, c)) depois[c] = patch[c]
  const versaoAtual = current?.readEdition ?? null
  const LIMPAR: ReadEditionWrite = { read_edition: null, read_edition_source: null }

  // Avaliação apagada inteira ⇒ a versão some junto (e não há o que escolher).
  if (!temAvaliacao(depois)) return versaoAtual == null ? null : LIMPAR

  if (context.kind === "explicit") {
    if (versaoAtual === context.edition) return null
    return { read_edition: context.edition, read_edition_source: "user_choice" }
  }
  if (context.kind === "unknown") {
    // A nota importada SUBSTITUI o rótulo: a versão dele deixa de ser conhecida. Reimportar a MESMA
    // nota não substitui nada — a versão fica. (`numeric` do PostgREST volta como string.)
    const trocaNota =
      Object.prototype.hasOwnProperty.call(patch, "user_score") && !sameScore(patch.user_score, antes.user_score)
    return trocaNota && versaoAtual != null ? LIMPAR : null
  }
  // Avaliação existente: a versão é dela — preservada, inclusive desconhecida.
  if (temAvaliacao(antes)) return null
  const edition = context.kind === "active" ? context.edition : input.defaultEdition
  if (edition == null) return null
  return { read_edition: edition, read_edition_source: "active_version" }
}

/**
 * O contexto de uma escrita vinda da TELA da obra: a versão ativa, validada (a action é endpoint
 * público — valor fora de `normal`/`r18` vale como "sem tela", ou seja, a padrão da conta).
 */
export function editionContextFrom(activeEdition: unknown): ReadEditionContext {
  const edition = parseMixedEdition(activeEdition)
  return edition ? { kind: "active", edition } : { kind: "default" }
}
