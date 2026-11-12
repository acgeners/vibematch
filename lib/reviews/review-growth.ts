/**
 * Quantas reviews uma obra ganhou DEPOIS da avaliação vigente — e em que ordem a fila
 * "Reviews novas" de /curation/works mostra as obras. PURO.
 *
 * O N vem do banco (`work_review_growth`, migration 220): reviews ÚTEIS (régua de
 * `MIN_USEFUL_REVIEW_LENGTH`, a mesma do 💬 do card) criadas depois da avaliação. O M ("tinha")
 * é o 💬 de agora menos o N — derivado, nunca contado de novo, para a conta fechar na tela.
 *
 * ⚠️ A ordem é por PROPORÇÃO (decisão de 2026-11-11): +10 sobre 6 vem antes de +12 sobre 80.
 * A pergunta da fila é "a evidência que a IA viu mudou?", e a avaliação manda no máximo 30
 * reviews — 12 a mais sobre 80 quase não mexe no que ela lê; 10 a mais sobre 6 mexe muito.
 */

export interface ReviewGrowth {
  /** Reviews úteis criadas depois da avaliação vigente. */
  newUseful: number
  /** Reviews úteis que já existiam quando a obra foi avaliada (💬 de agora − N). */
  before: number
}

/**
 * Monta o crescimento a partir do 💬 de agora e do N do banco. `null` quando a obra não tem
 * avaliação concluída (não há "desde" para medir). O M nunca fica negativo: se uma review foi
 * apagada depois, o 💬 cai e o N continua contando as que entraram.
 */
export function toReviewGrowth(usefulNow: number, newUseful: number | null | undefined): ReviewGrowth | null {
  if (newUseful == null) return null
  return { newUseful, before: Math.max(0, usefulNow - newUseful) }
}

/** N ÷ M. Sem nenhuma review antes, divide por 1: +5 sobre 0 vale 5, não infinito. */
export function reviewGrowthRatio(growth: ReviewGrowth): number {
  return growth.newUseful / Math.max(growth.before, 1)
}

/** O texto do card. `null` quando não entrou nada — a linha não aparece. */
export function describeReviewGrowth(growth: ReviewGrowth | null | undefined): string | null {
  if (!growth || growth.newUseful <= 0) return null
  const n = growth.newUseful
  return `+${n} ${n === 1 ? "review" : "reviews"} desde a avaliação (tinha ${growth.before})`
}

/**
 * Ordena para exibir e SÓ DEPOIS corta no teto. As que ganharam reviews vêm primeiro, pela
 * proporção (maior primeiro; empate, a que ganhou mais em número); o resto segue por título.
 *
 * 🔴 Cortar antes de ordenar era o defeito a evitar: a fila corta em 500 e tinha 770 obras com
 * reviews novas — cortando por título, as que mais cresceram podiam ficar de fora sem nada acusar.
 */
export function rankForDisplay<T extends { id: string; title: string | null }>(
  rows: readonly T[],
  growthById: ReadonlyMap<string, ReviewGrowth | null>,
  max: number,
): { displayed: T[]; matchedCount: number } {
  const keyed = rows.map((row) => {
    const g = growthById.get(row.id) ?? null
    return { row, g: g && g.newUseful > 0 ? g : null }
  })
  keyed.sort((a, b) => {
    if (a.g && b.g) {
      const byRatio = reviewGrowthRatio(b.g) - reviewGrowthRatio(a.g)
      if (byRatio !== 0) return byRatio
      const byCount = b.g.newUseful - a.g.newUseful
      if (byCount !== 0) return byCount
    } else if (a.g) {
      return -1
    } else if (b.g) {
      return 1
    }
    return String(a.row.title ?? "").localeCompare(String(b.row.title ?? ""))
  })
  return { displayed: keyed.slice(0, max).map((k) => k.row), matchedCount: rows.length }
}
