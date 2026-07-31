/**
 * Precedência da NOTA RÁPIDA (0–10, 1 toque) sobre o rótulo pessoal (`user_score`).
 *
 * Regra travada (2026-07-28): a FICHA COMPLETA SEMPRE VENCE — padrão COALESCE, como
 * `works.is_adult = coalesce(override, auto)`. Implementado por PRECEDÊNCIA DE ESCRITA,
 * não por coluna derivada: `user_score` continua sendo o único rótulo que os leitores
 * (Ridge, ranking, ledger) conhecem, e:
 *
 *   - sem ficha → a nota rápida faz write-through (`user_score = quick_score`);
 *   - com ficha → a nota rápida é só guardada (`quick_score`); o rótulo fica intacto;
 *   - a ficha, ao completar, SOBRESCREVE `user_score` (caminhos existentes:
 *     `applyTasteDerivedUserScore` / form de craft) — é o "COALESCE" acontecendo;
 *   - remover a nota rápida (score = null) desfaz o write-through SÓ se o rótulo
 *     atual veio dela (sem ficha) — rótulo de ficha nunca é tocado por aqui.
 *
 * Pura de propósito: é aqui que a regra mora, e é isto que os testes cobrem.
 */

export interface QuickScoreState {
  /** Nota rápida sendo salva; null = remover. */
  score: number | null
  /** `quick_score` atual da linha, se houver. */
  prevQuickScore: number | null
  /** `user_score` atual da linha (rótulo efetivo), se houver. */
  prevUserScore: number | null
  /** Existe FICHA: qualquer craft preenchido OU gosto completo (7 eixos). */
  fichaExists: boolean
  /** Gate "só avalia quem leu" (lib/reading-gate) para o estado atual do usuário. */
  canRate: boolean
}

export interface QuickScoreEffect {
  /** Patch a aplicar em user_work_state (sempre inclui quick_score). */
  patch: { quick_score: number | null; user_score?: number | null }
  /** O rótulo mudou? (dispara ledger + recalc; null→valor também liga a captura). */
  labelChange: "none" | "first" | "updated" | "removed"
}

export function resolveQuickScoreEffect(s: QuickScoreState): QuickScoreEffect {
  // Remoção: limpa a coluna própria; o rótulo só cai junto se VEIO do write-through —
  // sem ficha E igual à nota rápida gravada. Rótulo de ficha OU de import fica intacto
  // (apagar um user_score importado destruiria rótulo de treino que não é daqui).
  if (s.score == null) {
    const labelWasQuick =
      !s.fichaExists &&
      s.prevQuickScore != null &&
      s.prevUserScore != null &&
      Number(s.prevUserScore) === Number(s.prevQuickScore)
    if (labelWasQuick) {
      return { patch: { quick_score: null, user_score: null }, labelChange: "removed" }
    }
    return { patch: { quick_score: null }, labelChange: "none" }
  }

  // Guardar a nota rápida é sempre permitido (como os eixos de gosto); o que o gate
  // de leitura e a ficha controlam é o RÓTULO.
  if (s.fichaExists || !s.canRate) {
    return { patch: { quick_score: s.score }, labelChange: "none" }
  }

  if (s.prevUserScore == null) {
    return { patch: { quick_score: s.score, user_score: s.score }, labelChange: "first" }
  }
  if (Number(s.prevUserScore) === s.score) {
    return { patch: { quick_score: s.score }, labelChange: "none" }
  }
  return { patch: { quick_score: s.score, user_score: s.score }, labelChange: "updated" }
}
