import { CRITERION_SLUGS } from "@/types/domain"
import type { AttributeBiasMap } from "@/lib/ai-recommendation/calibrated-scores"
import type { SupabaseClient } from "@supabase/supabase-js"

// ============================================================
// Cálculo do offset de atributos (Fase 1.5)
// ============================================================
// Sinal bruto: delta = ia_value - user_value por amostra (obra avaliada
// pós-leitura). meanBiasRaw > 0 → a IA superestima o atributo.
//
// Shrinkage Bayesiano encolhe a correção quando há poucas amostras:
//   biasApplied = meanBiasRaw × n / (n + K)
// Com K=10: n=10 aplica 50%, n=50 aplica ~83%, n=0 aplica 0%.
//
// O pipeline aplica `valor_calibrado = valor_IA - biasApplied`
// (ver applyBiasToCategoryScores em lib/ai-recommendation/calibrated-scores.ts).

export const BIAS_SHRINKAGE_K = 10

export interface BiasComputation {
  attributeSlug: string
  nSamples: number
  meanBiasRaw: number
  biasApplied: number
  stddev: number | null // null quando n < 2
}

/**
 * Núcleo puro do cálculo. `deltas` = lista de (ia_value - user_value).
 * Sem amostras → tudo zero, sem correção.
 */
export function computeBiasForSlug(slug: string, deltas: number[]): BiasComputation {
  const n = deltas.length
  if (n === 0) {
    return { attributeSlug: slug, nSamples: 0, meanBiasRaw: 0, biasApplied: 0, stddev: null }
  }

  const mean = deltas.reduce((acc, d) => acc + d, 0) / n
  const biasApplied = mean * (n / (n + BIAS_SHRINKAGE_K))

  let stddev: number | null = null
  if (n >= 2) {
    const variance = deltas.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (n - 1)
    stddev = Math.sqrt(variance)
  }

  return {
    attributeSlug: slug,
    nSamples: n,
    meanBiasRaw: mean,
    biasApplied,
    stddev,
  }
}

interface AssessmentRow {
  attribute_slug: string
  user_value: number | string
  ia_value_at_assessment: number | string
}

/**
 * Lê todas as avaliações pós-leitura do usuário, recomputa o offset dos 9
 * atributos e faz UPSERT em attribute_bias. Retorna as 9 computações
 * (zeros pra atributos sem amostra).
 */
export async function recomputeAttributeBias(
  userId: string,
  supabase: SupabaseClient,
): Promise<BiasComputation[]> {
  const { data, error } = await supabase
    .from("user_attribute_assessment")
    .select("attribute_slug, user_value, ia_value_at_assessment")
    .eq("user_id", userId)

  if (error) throw new Error(`Falha lendo user_attribute_assessment: ${error.message}`)

  const deltasBySlug = new Map<string, number[]>()
  for (const slug of CRITERION_SLUGS) deltasBySlug.set(slug, [])

  for (const row of (data as AssessmentRow[] | null) ?? []) {
    const list = deltasBySlug.get(row.attribute_slug)
    if (!list) continue // ignora slugs fora dos 9 atributos
    list.push(Number(row.ia_value_at_assessment) - Number(row.user_value))
  }

  const computations: BiasComputation[] = CRITERION_SLUGS.map((slug) =>
    computeBiasForSlug(slug, deltasBySlug.get(slug) ?? []),
  )

  const now = new Date().toISOString()
  const rows = computations.map((c) => ({
    user_id: userId,
    attribute_slug: c.attributeSlug,
    n_samples: c.nSamples,
    mean_bias_raw: Number(c.meanBiasRaw.toFixed(2)),
    bias_applied: Number(c.biasApplied.toFixed(2)),
    stddev_bias: c.stddev == null ? null : Number(c.stddev.toFixed(2)),
    last_updated_at: now,
  }))

  const { error: upsertError } = await supabase
    .from("attribute_bias")
    .upsert(rows, { onConflict: "user_id,attribute_slug" })

  if (upsertError) throw new Error(`Falha gravando attribute_bias: ${upsertError.message}`)

  return computations
}

/**
 * Mapa slug → bias_applied pro pipeline. Atributos sem linha viram 0.
 */
export async function getBiasMap(userId: string, supabase: SupabaseClient): Promise<AttributeBiasMap> {
  const { data, error } = await supabase
    .from("attribute_bias")
    .select("attribute_slug, bias_applied")
    .eq("user_id", userId)

  if (error) throw new Error(`Falha lendo attribute_bias: ${error.message}`)

  const map: AttributeBiasMap = {}
  for (const slug of CRITERION_SLUGS) map[slug] = 0
  for (const row of (data as Array<{ attribute_slug: string; bias_applied: number | string }> | null) ??
    []) {
    map[row.attribute_slug] = Number(row.bias_applied)
  }
  return map
}
