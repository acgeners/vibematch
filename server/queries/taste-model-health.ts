import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { computeTasteModelHealth, type TasteModelHealth } from "@/lib/calculations/taste-model-health"
import type { WeightSuggestion } from "@/lib/ml/weight-inference"

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
