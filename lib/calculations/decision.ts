/**
 * Nota de Decisão — número único 0–10 ("quão provável é que o user goste desta
 * obra") usado pra escolher a próxima leitura sem olhar 9 critérios.
 *
 * IMPORTANTE: NÃO é a nota que o user daria — é um score de PRIORIDADE. A âncora
 * é a Nota Prevista (expected_score), que JÁ é personalizada (Ridge treinado nas
 * notas reais do user; o alinhamento é a feature nº 1 do modelo).
 *
 * Design (ver plano "Nota Final sem double-counting"):
 *  - A âncora é a Prevista, intacta. O fit NÃO entra aqui: ele já está embutido
 *    na Prevista com peso aprendido (CriterionFitScore, LovedTagOverlap...).
 *    Re-aplicá-lo seria double-counting (versão pior do mesmo sinal). O fit
 *    serve só de DESEMPATE dentro das bandas, na camada de exibição.
 *  - A IA Rk. (alignment_score 0–100) é o ÚNICO ajuste: é um veredito do LLM
 *    INDEPENDENTE, que não está na Prevista. Entra só quando existe (NULL na
 *    maioria das obras), ponderado pela confiança e capado em ALIGN_MAX_WEIGHT
 *    pra ajustar — nunca substituir — a previsão calibrada. NULL não afeta nada.
 */

// Peso máximo do veredito do LLM (quando confiança = 1). Capado pra que a IA Rk.
// AJUSTE, mas não substitua, a previsão calibrada. Junto do mapeamento
// `alignment/10`, é a constante mais discutível — isolada aqui pra tuning.
const ALIGN_MAX_WEIGHT = 0.35
// Confiança assumida quando o payload não traz `confidence` (runs do prompt v1).
const DEFAULT_CONFIDENCE = 0.6

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

export interface DecisionScoreInputs {
  /** Nota Prevista (expected_score) 0–10. Âncora — sem ela não há decisão. */
  expected: number | null
  /** alignment_score do LLM 0–100. NULL = obra ainda não passou pelo re-rank. */
  alignment: number | null
  /** Confiança do modelo 0–1 (alignment_payload.confidence). */
  confidence?: number | null
}

/**
 * Calcula a Nota de Decisão (0–10). Retorna `null` quando não há Nota Prevista
 * (sem âncora calibrada não dá pra decidir). Sem IA Rk, é igual à Prevista.
 */
export function computeDecisionScore({
  expected,
  alignment,
  confidence,
}: DecisionScoreInputs): number | null {
  if (expected == null) return null

  // Âncora = Prevista. O veredito do LLM (só quando presente) ajusta, ponderado
  // pela confiança e capado pra não dominar a previsão calibrada.
  let score = expected
  if (alignment != null) {
    const w = ALIGN_MAX_WEIGHT * clamp(confidence ?? DEFAULT_CONFIDENCE, 0, 1)
    score = score * (1 - w) + (alignment / 10) * w
  }

  return clamp(score, 0, 10)
}
