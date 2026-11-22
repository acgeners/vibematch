import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

/**
 * Qual nota pessoal VALE numa obra, e de onde ela veio — a régua das duas telas que dão nota (a
 * página da obra e o `/rate`). É a mesma precedência do servidor (`quick-score-precedence.ts` +
 * `applyTasteDerivedUserScore`), escrita do lado da TELA: as 7 categorias de gosto completas vencem;
 * a avaliação antiga por critérios (craft) também vence; sem nenhuma das duas, vale a nota direta.
 *
 * O painel de categorias e a nota direta ficam lado a lado, e cada um sozinho diria "a sua nota é
 * esta" — por isso a tela pergunta AQUI qual vale, em vez de cada controle decidir por conta própria.
 */

/**
 * As categorias que entram na conta: todas menos o "Final" (`allowsNa`) e o "geral" (`isOverall`) —
 * o mesmo recorte de `TASTE_LABEL_KEYS` no servidor, derivado dos critérios porque aquele módulo é
 * `server-only`. `tests/unit/ratings/nota-que-vale.test.ts` reprova se os dois divergirem.
 */
export function labelCriteria(criteria: Pick<TasteCriterion, "key" | "allowsNa" | "isOverall">[]): TasteScoreKey[] {
  return criteria.filter((c) => !c.allowsNa && !c.isOverall).map((c) => c.key)
}

export interface TasteLabelState {
  /** Quantas das categorias da conta já têm estrela. */
  filled: number
  /** Quantas entram na conta (7). */
  needed: number
  /** Média das preenchidas, com uma casa — com todas, é a nota que vira `user_score`. */
  average: number | null
  complete: boolean
}

/** A mesma conta de `computeTasteUserScore`: média simples das categorias da conta, uma casa. */
export function tasteLabelState(
  criteria: Pick<TasteCriterion, "key" | "allowsNa" | "isOverall">[],
  scores: Partial<Record<TasteScoreKey, number | null>>,
): TasteLabelState {
  const keys = labelCriteria(criteria)
  const values = keys.map((k) => scores[k]).filter((v): v is number => v != null)
  const average = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null
  return { filled: values.length, needed: keys.length, average, complete: keys.length > 0 && values.length === keys.length }
}

export type RatingSource = "categories" | "legacy" | "direct" | null

export interface EffectiveRating {
  value: number | null
  source: RatingSource
  /** A nota direta pode mudar a nota que vale? Não, quando uma avaliação completa já vence. */
  directAllowed: boolean
}

export function effectiveRating(input: {
  taste: TasteLabelState
  /** Há notas da avaliação antiga por critérios (os 8 `post_*`), hoje sem tela. */
  legacyPresent: boolean
  /** A nota gravada (`user_score`) ou a direta dada nesta tela. */
  score: number | null
}): EffectiveRating {
  if (input.taste.complete) return { value: input.taste.average, source: "categories", directAllowed: false }
  if (input.legacyPresent) return { value: input.score, source: "legacy", directAllowed: false }
  return { value: input.score, source: input.score == null ? null : "direct", directAllowed: true }
}

/** Nota com uma casa, em vírgula; inteira sem casa (a escala direta é de inteiros). */
export function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",")
}
