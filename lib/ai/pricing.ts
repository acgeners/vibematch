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
import { resolvePricingWindow } from "./pricing-window.js"

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreationPerMTok: number
}

export const PRICING_SNAPSHOT_TAG = pricingData.snapshotTag

/**
 * Overrides de preço consultados ANTES das janelas do JSON. Nasce VAZIO — existe como
 * costura para teste (injetar um modelo fictício) e para um override pontual em runtime.
 *
 * ⚠️ NÃO é a tabela de preços. Ela mora em `pricing-data.json`, em janelas com validade,
 * e é resolvida a cada chamada por `priceForModel` — congelar um mapa no import faria o
 * preço parar no instante do boot, e um servidor que atravessasse a virada de uma janela
 * (ex.: o fim da promo do Sonnet 5 em 31/08) seguiria cobrando o preço velho até reiniciar.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {}

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

/**
 * Preço vigente de um modelo no instante `at` (default: agora).
 *
 * A resolução é POR CHAMADA, nunca no import: o custo de cada linha de `ai_api_calls` é
 * "o preço na hora em que a chamada aconteceu", e o histórico já gravado não é reescrito.
 * Quem seleciona a janela é `lib/ai/pricing-window.js` — o MESMO resolvedor que
 * `scripts/lib/ai-log.js` usa, para app e scripts não gravarem custos diferentes na
 * mesma tabela.
 */
export function priceForModel(model: string, at?: Date | number): ModelPricing | null {
  return (
    MODEL_PRICING[model] ??
    resolvePricingWindow(
      pricingData.models as Parameters<typeof resolvePricingWindow>[0],
      model,
      at,
    )
  )
}

export function computeCostUsd(model: string, usage: UsageTokens, at?: Date | number): CostBreakdown {
  const price = priceForModel(model, at)
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
