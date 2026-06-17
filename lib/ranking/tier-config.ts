import { z } from "zod"

/**
 * Largura da banda de tiers do ranking. É uma regra de AGRUPAMENTO/APRESENTAÇÃO
 * (não faz parte da fórmula do score) — por isso vive em `lib/ranking`, não em
 * `lib/calculations`.
 *
 * O valor é PROVISÓRIO (0,5) e deve ser validado empiricamente (curva de acurácia
 * pairwise × Δprevisto, percentis, clusters). Persistido em
 * `formula_config.tier_band_width` para ser ajustável SEM mudança de código.
 */
export const DEFAULT_TIER_BAND_WIDTH = 0.5

// Mesmo range do CHECK da migration 104 (0,05–2). Banda fora disso é erro.
export const tierBandWidthSchema = z.number().min(0.05).max(2)

/**
 * Resolve a largura vinda do banco. Usa o default APENAS quando o valor está
 * ausente (sem registro de config / coluna ainda não migrada → `null`/`undefined`).
 * Um valor presente porém inválido (fora do range) NÃO é mascarado silenciosamente:
 * loga e cai no default. `numeric` do Postgres pode chegar como string.
 */
export function resolveTierBandWidth(raw: unknown): number {
  if (raw == null) return DEFAULT_TIER_BAND_WIDTH
  const value = typeof raw === "string" ? Number(raw) : raw
  const parsed = tierBandWidthSchema.safeParse(value)
  if (!parsed.success) {
    console.warn(`[ranking] tier_band_width inválido (${String(raw)}); usando default ${DEFAULT_TIER_BAND_WIDTH}`)
    return DEFAULT_TIER_BAND_WIDTH
  }
  return parsed.data
}
