/**
 * Nota de Decisão — combina as três notas do ranking (Prevista, Alinhamento e
 * IA Rk.) num único número 0–10 usado pra ordenar "o que ler primeiro" quando a
 * Nota Prevista de várias obras é parecida (ex: 8.5 / 8.5 / 8.3, diferença
 * dentro do erro do modelo).
 *
 * IMPORTANTE: é um score de PRIORIDADE/decisão, NÃO uma previsão de nota. A Nota
 * Prevista (expected_score) é a âncora calibrada; aqui ela é apenas modulada
 * pelo alinhamento e puxada pelo veredito do LLM quando existe.
 *
 * Design (ver plano "Nota de Decisão + desempate"):
 *  - A Prevista JÁ contém o alinhamento nas suas features (CriterionFitScore,
 *    LovedTagOverlap...), então o fit entra aqui como MODULAÇÃO LIMITADA
 *    (±FIT_SWING/2), não como termo de média — evita double-counting pesado.
 *  - A IA Rk. (alignment_score 0–100) entra SÓ quando existe (NULL na maioria
 *    das obras), ponderada pela confiança do modelo e capada em ALIGN_MAX_WEIGHT
 *    pra nunca dominar a previsão calibrada. NULL não afeta o resultado.
 */

// Amplitude total da modulação por fit: ±FIT_SWING/2 em torno do neutro.
// 0.20 → no máximo +10% (fit no topo) / -10% (fit zero) sobre a Prevista.
const FIT_SWING = 0.2
// Topo do intervalo de fit. O personal_fit cru tem teto matemático ~0.55, então
// o fit é mapeado linearmente: [0, FIT_REF] → [-FIT_SWING/2, +FIT_SWING/2],
// com o ponto NEUTRO (modulação 1.0) em FIT_REF/2 = 0.25 e saturação em FIT_REF.
// Usar o valor cru (não o percentil) mantém o número estável/independente da view.
const FIT_REF = 0.5
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
  /** personal_fit cru 0–1 (não o percentil). NULL = perfil sem sinal. */
  fit: number | null
  /** alignment_score do LLM 0–100. NULL = obra ainda não passou pelo re-rank. */
  alignment: number | null
  /** Confiança do modelo 0–1 (alignment_payload.confidence). */
  confidence?: number | null
}

/**
 * Calcula a Nota de Decisão (0–10). Retorna `null` quando não há Nota Prevista
 * (sem âncora calibrada não dá pra decidir).
 */
export function computeDecisionScore({
  expected,
  fit,
  alignment,
  confidence,
}: DecisionScoreInputs): number | null {
  if (expected == null) return null

  // 1) Fit como modulação limitada, centrada no fit de referência.
  const fitMod = fit == null ? 1 : 1 + FIT_SWING * (clamp(fit / FIT_REF, 0, 1) - 0.5)
  let score = expected * fitMod

  // 2) Veredito do LLM (só quando presente), ponderado pela confiança.
  if (alignment != null) {
    const w = ALIGN_MAX_WEIGHT * clamp(confidence ?? DEFAULT_CONFIDENCE, 0, 1)
    score = score * (1 - w) + (alignment / 10) * w
  }

  return clamp(score, 0, 10)
}
