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
  if (isTiebreak) return { label: "Desempate de comparação", Icon: Scale }
  if (mode === "next_read") return { label: "Próxima leitura (não-lidos)", Icon: BookOpen }
  if (mode === "ranking") return { label: "Recomendado do ranking", Icon: Sparkles }
  return { label: "Recomendação geral (favoritos)", Icon: ChartNoAxesCombined }
}

/**
 * Legenda dos ícones de modo exibidos nos cards do histórico. Derivada de
 * `getRunModeDisplay` pra ficar sempre em sincronia com os rótulos/ícones reais.
 */
export const RUN_MODE_LEGEND: RunModeDisplay[] = [
  getRunModeDisplay("full_analysis", false), // Re-ranquear favoritos
  getRunModeDisplay("next_read", false), // Próxima leitura
  getRunModeDisplay("ranking", false), // Ranking (filtrado)
  getRunModeDisplay("ranking", true), // Desempate
]
