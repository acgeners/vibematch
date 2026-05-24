// Pricing Anthropic — USD por 1.000.000 de tokens.
//
// Valores extraídos de https://platform.claude.com/docs/en/about-claude/pricing
// em 2026-05-23. Re-verifique antes de fazer claims pesadas — preços mudam.
//
// O código usa `cache_control: { type: "ephemeral" }` em todos os call sites,
// que é o cache de 5 minutos (multiplicador 1.25× input). Se algum dia
// passarmos a usar cache de 1 hora (2× input), atualize cacheCreationPerMTok.
//
// Multiplicadores típicos (confirmados na pricing page):
//   cache_read  = 0.10 × input
//   cache_write (5min) = 1.25 × input

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreationPerMTok: number
}

export const PRICING_SNAPSHOT_TAG = "static@2026-05-23"

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheCreationPerMTok: 3.75,
  },
  "claude-opus-4-7": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheCreationPerMTok: 6.25,
  },
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheCreationPerMTok: 1.25,
  },
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface CostBreakdown {
  costInputUsd: number
  costOutputUsd: number
  costCacheReadUsd: number
  costCacheCreationUsd: number
  pricingSource: string
}

const MILLION = 1_000_000

export function priceForModel(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null
}

export function computeCostUsd(model: string, usage: UsageTokens): CostBreakdown {
  const price = priceForModel(model)
  if (!price) {
    return {
      costInputUsd: 0,
      costOutputUsd: 0,
      costCacheReadUsd: 0,
      costCacheCreationUsd: 0,
      pricingSource: `unknown@${model}`,
    }
  }
  return {
    costInputUsd: (usage.inputTokens / MILLION) * price.inputPerMTok,
    costOutputUsd: (usage.outputTokens / MILLION) * price.outputPerMTok,
    costCacheReadUsd: (usage.cacheReadTokens / MILLION) * price.cacheReadPerMTok,
    costCacheCreationUsd: (usage.cacheCreationTokens / MILLION) * price.cacheCreationPerMTok,
    pricingSource: PRICING_SNAPSHOT_TAG,
  }
}
