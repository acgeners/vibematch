import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeTasteModelHealth, type TasteModelHealth } from "@/lib/calculations/taste-model-health"
import type { WeightSuggestion } from "@/lib/ml/weight-inference"
import type { OofBucketBreakdown } from "@/lib/calculations/calibration"

/**
 * Saúde do modelo de gosto a partir do `score_weights_inferred` JÁ persistido no
 * recalc (declarado = peso manual × inferido = Ridge + bootstrap). Sem rede/ML
 * novo — só lê e computa os flags. Null quando a inferência ainda não rodou
 * (poucas obras rotuladas / pré-recalc), aí o painel esconde a seção.
 */
export async function getTasteModelHealth(): Promise<TasteModelHealth | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("formula_config")
    .select("score_weights_inferred")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const inferred = data?.score_weights_inferred as
    | { suggestions?: unknown[]; trainSize?: number }
    | null
    | undefined
  if (!inferred?.suggestions?.length) return null
  return computeTasteModelHealth(
    inferred.suggestions as unknown as WeightSuggestion[],
    inferred.trainSize ?? 0,
  )
}

/**
 * Breakdown OUT-OF-FOLD do MAE da Nota Prevista por faixa (tipicidade/votos), já
 * computado no recalc e guardado em `expected_ridge_coefficients.oofBucketBreakdown`.
 * Null quando não há OOF (treino < 30 / stub). Alimenta o "Onde a Nota Prevista
 * erra mais" em Viés & atributos.
 */
export async function getOofBucketBreakdown(): Promise<OofBucketBreakdown | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("formula_config")
    .select("expected_ridge_coefficients")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const ridge = data?.expected_ridge_coefficients as
    | { oofBucketBreakdown?: OofBucketBreakdown | null }
    | null
    | undefined
  return ridge?.oofBucketBreakdown ?? null
}
