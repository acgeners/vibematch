/**
 * Representação honesta das métricas de erro do modelo de previsão (Nota Prevista).
 *
 * Motivação (AUDIT_REPORT §7.7 / F4): existem DUAS MAEs distintas com o mesmo
 * "cara" de número:
 *   - in-sample (`mae_expected` ≈ 0,545): erro do modelo sobre os MESMOS rótulos
 *     usados pra ajustá-lo — otimista, não representa obras não-lidas;
 *   - cross-validation / OOF (`cv_mae_expected_stage1` ≈ 0,579): erro fora da
 *     amostra de cada fold — a estimativa honesta do que o modelo erra em obras
 *     que ele ainda não viu.
 *
 * Este módulo NÃO calcula MAE; ele apenas normaliza + valida os valores vindos
 * do banco e decide QUAL exibir como métrica principal, garantindo que a
 * in-sample nunca seja a vitrine. A métrica prospectiva (prediction_ledger)
 * entra como prioridade máxima quando houver amostra suficiente.
 *
 * Funções puras + sem efeitos colaterais → fáceis de testar e reusar tanto no
 * painel de calibração quanto na página técnica /admin/model-metrics.
 */

import { z } from "zod"

/**
 * Amostra mínima de previsões resolvidas pra a métrica PROSPECTIVA virar a
 * principal. Abaixo disso ela é instável (IC largo) → mostramos a CV/OOF como
 * principal e a prospectiva só como "amostra inicial".
 *
 * PROVISÓRIO: 30 é uma régua de bolso (limiar comum pra "amostra pequena").
 * Deve ser revisitado com dados reais do ledger.
 */
export const MIN_PROSPECTIVE_SAMPLE_SIZE = 30

export type DisplayMetricSource = "prospective" | "cross-validation" | "unavailable"

// ── Coerção/validação dos valores crus do banco ────────────────────────────
// Supabase devolve `numeric` ora como number, ora como string. Aqui tudo que
// não for um número finito legítimo vira `null` — nunca inventamos 0/""/NaN
// como métrica válida (regra explícita da F4).

function toFiniteNumberOrNull(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed === "") return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// MAE/RMSE: erro médio. 0 ou negativo é implausível pra dados reais held-out
// (MAE 0 = ajuste perfeito = quase certamente leak/valor default) → tratado
// como ausência de métrica, não como "modelo perfeito".
const maeField = z.preprocess((raw) => {
  const n = toFiniteNumberOrNull(raw)
  return n != null && n > 0 ? n : null
}, z.number().positive().nullable())

// Contagem de amostras: inteiro ≥ 0 (0 = "sem amostra" é legítimo).
const sampleSizeField = z.preprocess((raw) => {
  const n = toFiniteNumberOrNull(raw)
  if (n == null) return null
  const i = Math.trunc(n)
  return i >= 0 ? i : null
}, z.number().int().nonnegative().nullable())

// Nº de folds: inteiro > 0 (0 fold não faz sentido).
const foldCountField = z.preprocess((raw) => {
  const n = toFiniteNumberOrNull(raw)
  if (n == null) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}, z.number().int().positive().nullable())

// Timestamp: ISO parseável e não-vazio, senão null.
const timestampField = z.preprocess((raw) => {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed === "") return null
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null
}, z.string().nullable())

export const modelEvaluationMetricsSchema = z.object({
  /** MAE in-sample (sobre o próprio treino) — DIAGNÓSTICO, nunca a vitrine. */
  trainMae: maeField,
  /** MAE cross-validation / OOF — a estimativa honesta pra obras não-lidas. */
  crossValidationMae: maeField,
  /** MAE prospectiva (prediction_ledger): previsto ANTES do rótulo real. */
  prospectiveMae: maeField,
  /** MAE do baseline trivial (prever a média) — piso a ser batido. */
  baselineMae: maeField,
  /** Nº de obras rotuladas usadas no treino/CV. */
  sampleSize: sampleSizeField,
  /** Nº de folds da CV (informativo). */
  foldCount: foldCountField,
  /** Quando o modelo foi (re)treinado/avaliado. */
  evaluatedAt: timestampField,
  /** Nº de previsões resolvidas no ledger. */
  prospectiveSampleSize: sampleSizeField,
  /** Última resolução prospectiva. */
  prospectiveEvaluatedAt: timestampField,
})

export type ModelEvaluationMetrics = z.infer<typeof modelEvaluationMetricsSchema>

const METRIC_KEYS = [
  "trainMae",
  "crossValidationMae",
  "prospectiveMae",
  "baselineMae",
  "sampleSize",
  "foldCount",
  "evaluatedAt",
  "prospectiveSampleSize",
  "prospectiveEvaluatedAt",
] as const

/**
 * Normaliza + valida via Zod um objeto cru (ex.: linha de formula_config +
 * agregados do snapshot/ledger). Chaves ausentes ou inválidas viram `null`.
 *
 * Pré-preenchemos todas as chaves (Zod v4 trata chave ausente como erro
 * "nonoptional" mesmo com preprocess) — só `undefined`/`null` viram null, então
 * valores legítimos como `0`/`""`/`NaN` ainda passam pela validação por campo.
 */
export function parseModelEvaluationMetrics(raw: unknown): ModelEvaluationMetrics {
  const obj = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const input: Record<string, unknown> = {}
  for (const k of METRIC_KEYS) input[k] = obj[k] ?? null
  return modelEvaluationMetricsSchema.parse(input)
}

export interface PrimaryModelMetric {
  mae: number | null
  source: DisplayMetricSource
  sampleSize: number | null
  evaluatedAt: string | null
}

/**
 * Escolhe a métrica PRINCIPAL a ser exibida, na ordem:
 *   1. prospectiva (se houver amostra ≥ MIN_PROSPECTIVE_SAMPLE_SIZE);
 *   2. cross-validation / OOF;
 *   3. indisponível.
 *
 * A MAE in-sample (`trainMae`) NUNCA é retornada como principal — ela só existe
 * como diagnóstico em área técnica, sempre rotulada como in-sample.
 */
export function selectPrimaryModelMetric(metrics: ModelEvaluationMetrics): PrimaryModelMetric {
  if (
    metrics.prospectiveMae != null &&
    metrics.prospectiveSampleSize != null &&
    metrics.prospectiveSampleSize >= MIN_PROSPECTIVE_SAMPLE_SIZE
  ) {
    return {
      mae: metrics.prospectiveMae,
      source: "prospective",
      sampleSize: metrics.prospectiveSampleSize,
      evaluatedAt: metrics.prospectiveEvaluatedAt,
    }
  }

  if (metrics.crossValidationMae != null) {
    return {
      mae: metrics.crossValidationMae,
      source: "cross-validation",
      sampleSize: metrics.sampleSize,
      evaluatedAt: metrics.evaluatedAt,
    }
  }

  return { mae: null, source: "unavailable", sampleSize: null, evaluatedAt: null }
}

/**
 * Redução RELATIVA de erro do modelo em relação ao baseline trivial.
 * Retorna fração (ex.: 0,22 = 22% menos erro). Positivo = modelo melhor;
 * negativo = pior que o baseline. `null` quando não dá pra comparar com
 * honestidade (baseline ≤ 0, valores não-finitos, modelo negativo).
 *
 * NÃO é "acurácia" — é redução de erro vs baseline.
 */
export function calculateRelativeErrorReduction(
  modelMae: number,
  baselineMae: number,
): number | null {
  if (!Number.isFinite(modelMae) || !Number.isFinite(baselineMae)) return null
  if (baselineMae <= 0) return null
  if (modelMae < 0) return null
  const reduction = (baselineMae - modelMae) / baselineMae
  return Number.isFinite(reduction) ? reduction : null
}

export interface MetricSourceCopy {
  /** Rótulo curto pra cima do número. */
  title: string
  /** Texto do tooltip explicando a origem. */
  tooltip: string
}

/**
 * Copy (rótulo + tooltip) por origem de métrica. Mantém os textos honestos
 * num só lugar, reusável e testável (a UI não inventa rótulo ambíguo "MAE: x").
 */
export function describeMetricSource(source: DisplayMetricSource): MetricSourceCopy {
  switch (source) {
    case "prospective":
      return {
        title: "Erro médio prospectivo",
        tooltip:
          "Calculado usando previsões registradas ANTES de a avaliação real ser conhecida (prediction_ledger). É a evidência mais forte de que o modelo funciona em uso real.",
      }
    case "cross-validation":
      return {
        title: "Erro médio em validação cruzada",
        tooltip:
          "Estimativa calculada fora da amostra de treino de cada fold. Representa melhor o erro esperado em obras ainda não avaliadas do que a métrica in-sample.",
      }
    case "unavailable":
      return {
        title: "Precisão indisponível",
        tooltip:
          "Ainda não há métrica honesta (CV/OOF ou prospectiva) disponível — modelo em fallback ou treino insuficiente.",
      }
  }
}
