import "server-only"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import type { CriterionRange } from "@/components/ui/score-badge"

/**
 * Faixas ideais por critério do perfil atual, normalizadas pro formato que as
 * tabelas/heatmap consomem na cor "Minha faixa" (`criterion_preferences` é
 * `Partial<Record<...>>` com valores opcionais — aqui filtramos os ausentes).
 * Retorna `{}` quando não há perfil — o toggle some e a cor cai no catálogo.
 */
export async function getCriterionColorRanges(): Promise<Record<string, CriterionRange>> {
  const profile = await loadCurrentTasteProfile()
  const prefs = profile?.profile.criterion_preferences
  if (!prefs) return {}
  const out: Record<string, CriterionRange> = {}
  for (const [slug, pref] of Object.entries(prefs)) {
    if (!pref) continue
    out[slug] = { ideal_min: pref.ideal_min, ideal_max: pref.ideal_max, weight: pref.weight }
  }
  return out
}
