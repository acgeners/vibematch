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

// Fonte ÚNICA dos preços: lib/ai/pricing-data.json. Compartilhada com o adaptador
// de logger dos scripts (scripts/lib/ai-log.js) — preços NÃO são duplicados
// (plano §17). Atualize só o JSON.
import pricingData from "./pricing-data.json"

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreationPerMTok: number
}

export const PRICING_SNAPSHOT_TAG = pricingData.snapshotTag

export const MODEL_PRICING: Record<string, ModelPricing> = { ...pricingData.models }

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
