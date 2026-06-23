import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { resolveTierBandWidth, DEFAULT_TIER_BAND_WIDTH } from "@/lib/ranking/tier-config"

/**
 * Lê a largura da banda de tiers de `formula_config`. Usa `select("*")` (mesmo
 * padrão de score-thresholds) para TOLERAR a coluna ainda não migrada: nesse caso
 * `tier_band_width` simplesmente não vem no row e cai no default — sem disparar
 * "column does not exist". Não cacheado de propósito: ajustar o valor no banco
 * deve refletir nos tiers já na próxima request, sem mudança de código.
 */
export async function getTierBandWidth(): Promise<number> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("formula_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const raw =
      data && typeof data === "object" && "tier_band_width" in data
        ? (data as Record<string, unknown>).tier_band_width
        : null
    return resolveTierBandWidth(raw)
  } catch {
    return DEFAULT_TIER_BAND_WIDTH
  }
}
