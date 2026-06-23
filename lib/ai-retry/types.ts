/**
 * Política de retry das chamadas de IA (plano §13). Tudo PURO.
 *
 * IMPORTANTE (decisão do usuário, plano §15 Opção 1): NÃO substituímos os retries
 * internos do SDK Anthropic. O SDK segue cuidando dos retries de rede (429/529/
 * 5xx/timeout) com backoff+jitter+Retry-After próprios — comportamento testado,
 * não mexemos. Este módulo é a política EXPLÍCITA e testável (sem números mágicos)
 * usada para: (a) classificar erros como retryable/não p/ telemetria do painel;
 * (b) documentar os retries que NÓS controlamos (fallback de imagem 1×, reparo
 * estrutural ≤2). O backoff aqui só é exercido se um dia ligarmos retry central.
 */

import type { AiErrorCategory } from "@/lib/ai-observability/types"

export interface AiRetryPolicy {
  /** Tentativas TOTAIS (1ª + retries). maxRetries do SDK = maxAttempts - 1. */
  maxAttempts: number
  timeoutPerAttemptMs: number | null
  totalBudgetMs: number | null
  baseDelayMs: number
  maxDelayMs: number
  /** Fração de jitter (0–1). 0.2 = ±20% em torno do delay base. */
  jitterRatio: number
  honorRetryAfter: boolean
  retryableStatusCodes: readonly number[]
}

export interface RetryDecision {
  retryable: boolean
  reason: AiErrorCategory
}
