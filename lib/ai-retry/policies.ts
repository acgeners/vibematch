/**
 * Políticas explícitas (plano §13). Documentam o que JÁ acontece — não mudam
 * execução. Centraliza os números para não ficarem espalhados como mágicos.
 */

import type { AiRetryPolicy } from "./types"

// Status que o SDK Anthropic retenta por padrão (+ 529 Overloaded da Anthropic).
const PROVIDER_RETRYABLE_STATUS = [408, 409, 429, 500, 502, 503, 504, 529] as const

/**
 * Política PADRÃO da maioria dos callers (getAnthropicClient maxRetries=6 ⇒ 7
 * tentativas totais). O backoff/jitter/Retry-After reais são do SDK; os valores
 * aqui são a descrição honesta da ordem de grandeza para o painel/telemetria.
 */
export const SDK_DEFAULT_POLICY: AiRetryPolicy = {
  maxAttempts: 7, // maxRetries 6 + 1
  timeoutPerAttemptMs: null,
  totalBudgetMs: null,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.25,
  honorRetryAfter: true,
  retryableStatusCodes: PROVIDER_RETRYABLE_STATUS,
}

/**
 * Avaliação IA usa maxRetries=8 (⇒ 9 tentativas totais) p/ aguentar janelas
 * longas de 529 "Overloaded" no meio de um batch.
 */
export const AI_EVALUATION_POLICY: AiRetryPolicy = {
  ...SDK_DEFAULT_POLICY,
  maxAttempts: 9, // maxRetries 8 + 1
}

/** Retries que NÓS controlamos (não são de rede; têm fallback próprio limitado). */
export const IMAGE_FALLBACK_MAX_ATTEMPTS = 1 // 1 tentativa com imagem → 1 sem
export const STRUCTURED_REPAIR_MAX_ATTEMPTS = 2 // loop attempt < 2 (1 reparo)
