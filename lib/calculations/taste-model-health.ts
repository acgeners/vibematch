import type { CriterionSlug } from "@/types/domain"
import type { WeightSuggestion, WeightConfidence } from "@/lib/ml/weight-inference"

/**
 * "Saúde do modelo de gosto" — diagnóstico de VULNERABILIDADES dos pesos que o
 * modelo aprendeu das suas notas, comparando o peso DECLARADO (o manual, em
 * `score_weights`) com o INFERIDO (Ridge + bootstrap sobre as obras rotuladas).
 *
 * Não é uma lista de pesos: é "onde o modelo pode estar te lendo errado". Puro e
 * testável — recebe as sugestões já computadas (`score_weights_inferred`) e emite
 * flags. Sem rede, sem ML novo.
 */

export type TasteFlagKind =
  /** declarado e inferido em direções OPOSTAS (o modelo aprendeu o contrário do que você pôs). */
  | "sign_flip"
  /** peso declarado forte, mas o inferido colapsou pra ~0 (seu ajuste não "pega" nos dados). */
  | "unsupported"
  /** o modelo aposta forte num critério cujo coeficiente é instável (provável ruído/overfit). */
  | "fragile_bet"

export type TasteFlagSeverity = "high" | "medium"

export interface TasteFlag {
  kind: TasteFlagKind
  severity: TasteFlagSeverity
}

export interface TasteCriterionHealth {
  slug: CriterionSlug
  /** Peso manual (o "declarado"). */
  currentWeight: number
  /** Peso aprendido dos dados. */
  suggestedWeight: number
  delta: number
  confidence: WeightConfidence
  flags: TasteFlag[]
}

export interface TasteModelHealth {
  trainSize: number
  /** Todos os critérios, ordenados: com flag (severidade alta 1º) → resto por |Δ|. */
  criteria: TasteCriterionHealth[]
  /** Só os com flag (o destaque do painel). */
  flagged: TasteCriterionHealth[]
  counts: { signFlip: number; unsupported: number; fragile: number }
  /** Base pequena → todos os pesos são mais incertos (mais dado = alavanca). */
  smallBase: boolean
}

// Um peso abaixo disto (em módulo) é "trivial" — não conta como sinal nem gera flag.
export const MEANINGFUL_WEIGHT = 3
// "Declarado forte" pro flag de peso-sem-sustentação.
export const STRONG_DECLARED = 8
// "Inferido forte" pro flag de aposta-frágil.
export const STRONG_INFERRED = 10
// Abaixo disto o modelo é tratado como "base modesta" (aviso, não erro).
export const SMALL_BASE_THRESHOLD = 300

const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

/** Emite os flags de UM critério a partir da sua sugestão de peso. */
export function flagsForCriterion(s: WeightSuggestion): TasteFlag[] {
  const flags: TasteFlag[] = []
  const cur = s.currentWeight
  const inf = s.suggestedWeight
  const bothMeaningful = Math.abs(cur) >= MEANINGFUL_WEIGHT && Math.abs(inf) >= MEANINGFUL_WEIGHT

  if (bothMeaningful && sign(cur) !== 0 && sign(inf) !== 0 && sign(cur) !== sign(inf)) {
    // Direções opostas: o conflito mais grave (declarado × aprendido).
    flags.push({ kind: "sign_flip", severity: "high" })
  } else if (Math.abs(cur) >= STRONG_DECLARED && Math.abs(inf) < MEANINGFUL_WEIGHT) {
    // Peso manual forte que evaporou no aprendido: seu ajuste não tem sustentação.
    flags.push({ kind: "unsupported", severity: "medium" })
  }
  // Independente do acima: aposta grande sobre coeficiente instável = provável ruído.
  if (Math.abs(inf) >= STRONG_INFERRED && s.confidence === "low") {
    flags.push({ kind: "fragile_bet", severity: "medium" })
  }
  return flags
}

export function computeTasteModelHealth(
  suggestions: WeightSuggestion[],
  trainSize: number,
): TasteModelHealth {
  const criteria: TasteCriterionHealth[] = suggestions.map((s) => ({
    slug: s.slug,
    currentWeight: s.currentWeight,
    suggestedWeight: s.suggestedWeight,
    delta: s.delta,
    confidence: s.confidence,
    flags: flagsForCriterion(s),
  }))

  // Ordena: flag de severidade alta → flag média → sem flag; desempate por |Δ|.
  const rank = (c: TasteCriterionHealth) =>
    c.flags.some((f) => f.severity === "high") ? 0 : c.flags.length > 0 ? 1 : 2
  criteria.sort((a, b) => rank(a) - rank(b) || Math.abs(b.delta) - Math.abs(a.delta))

  const has = (c: TasteCriterionHealth, k: TasteFlagKind) => c.flags.some((f) => f.kind === k)
  return {
    trainSize,
    criteria,
    flagged: criteria.filter((c) => c.flags.length > 0),
    counts: {
      signFlip: criteria.filter((c) => has(c, "sign_flip")).length,
      unsupported: criteria.filter((c) => has(c, "unsupported")).length,
      fragile: criteria.filter((c) => has(c, "fragile_bet")).length,
    },
    smallBase: trainSize < SMALL_BASE_THRESHOLD,
  }
}
