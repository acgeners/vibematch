import { BookOpen, ChartNoAxesCombined, Scale, Sparkles, type LucideIcon } from "lucide-react"
import type { RecommendationMode } from "@/lib/ai-recommendation/types"

export interface RunModeDisplay {
  label: string
  Icon: LucideIcon
}

/**
 * Rótulo + ícone de uma run de recomendação. FONTE ÚNICA — usada tanto na lista
 * de histórico quanto na página de detalhe (`/recommendations` e `/{slug}`).
 *
 * `isTiebreak` (de `source_meta.tiebreak`) tem precedência sobre o `mode`: um
 * desempate salvo grava `mode="ranking"`, então sem essa flag ele seria rotulado
 * como uma recomendação de ranking comum.
 */
export function getRunModeDisplay(mode: RecommendationMode, isTiebreak: boolean): RunModeDisplay {
  if (isTiebreak) return { label: "Desempate", Icon: Scale }
  if (mode === "next_read") return { label: "Próxima leitura", Icon: BookOpen }
  if (mode === "ranking") return { label: "Ranking (filtrado)", Icon: Sparkles }
  return { label: "Re-ranquear favoritos", Icon: ChartNoAxesCombined }
}
