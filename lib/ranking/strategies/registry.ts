/**
 * Registro central e VERSIONADO das estratégias de ranking (shadow mode).
 *
 * Cada estratégia tem uma versão EXPLÍCITA (não o nome como versão). Qualquer
 * mudança em fórmula / peso / desempate / tratamento de null / aplicação de mood
 * / formação de tiers de uma estratégia exige BUMP da versão (v1→v2), nunca
 * reescrita — pra não sobrescrever resultados históricos (AUDIT_REPORT §15).
 */

export type RankingStrategyKey =
  | "displayed_current"
  | "calc_score"
  | "expected_score"
  | "decision_score"
  | "personal_fit"
  | "alignment_score"
  | "mood_within_tier"

export interface RankingStrategyDefinition {
  key: RankingStrategyKey
  version: string
  label: string
  description: string
  experimental: boolean
}

export const RANKING_STRATEGIES: Record<RankingStrategyKey, RankingStrategyDefinition> = {
  displayed_current: {
    key: "displayed_current",
    version: "v1",
    label: "Ranking exibido",
    description: "Ordem realmente entregue à interface (LLM ranker) + tiers exibidos. Referência de comparação.",
    experimental: false,
  },
  calc_score: {
    key: "calc_score",
    version: "v1",
    label: "Nota.Calc",
    description: "Ordena só por calc_score. Baseline determinístico (sem Ridge, sem veredito LLM).",
    experimental: true,
  },
  expected_score: {
    key: "expected_score",
    version: "v1",
    label: "Nota Prevista",
    description: "Ordena só pela satisfação prevista (Ridge⊕calc). Usa o predicted_score do snapshot.",
    experimental: true,
  },
  decision_score: {
    key: "decision_score",
    version: "v1",
    label: "Prioridade (decisão)",
    description: "Ordena por decision_score (Prevista ajustada pelo veredito IA quando há alignment).",
    experimental: true,
  },
  personal_fit: {
    key: "personal_fit",
    version: "v1",
    label: "Afinidade",
    description: "Ordena só por personal_fit. Baseline de compatibilidade, não candidata a substituir o ranking.",
    experimental: true,
  },
  alignment_score: {
    key: "alignment_score",
    version: "v1",
    label: "Veredito IA",
    description: "Ordena só por alignment_score. Cobertura parcial (só obras re-rankeadas) — comparar no subconjunto comum.",
    experimental: true,
  },
  mood_within_tier: {
    key: "mood_within_tier",
    version: "v1",
    label: "Mood dentro do tier",
    description: "Preserva os tiers exibidos e reordena DENTRO de cada tier pelo mood. Só em runs com mood ativo.",
    experimental: true,
  },
}

export const ALL_STRATEGY_KEYS = Object.keys(RANKING_STRATEGIES) as RankingStrategyKey[]

export function getStrategyDefinition(key: RankingStrategyKey): RankingStrategyDefinition {
  return RANKING_STRATEGIES[key]
}
