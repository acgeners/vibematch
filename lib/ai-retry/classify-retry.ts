/**
 * Classificação retryable/não-retryable (plano §14). Reusa o classificador
 * central de erros (lib/ai-observability) — NÃO duplica heurística de texto.
 */

import { classifyAiError, type ClassifyAiErrorInput } from "@/lib/ai-observability/classify-error"
import type { AiErrorCategory } from "@/lib/ai-observability/types"
import type { RetryDecision } from "./types"

/**
 * Categorias TRANSITÓRIAS (normalmente retryable, §14). As demais — 400 genérico,
 * imagem inválida, schema/Zod, auditoria, cancelado, interno, unknown — NÃO são
 * retentadas por rede (imagem e estruturado têm seus próprios fallbacks
 * limitados; não viram retry de rede).
 */
const RETRYABLE_CATEGORIES: ReadonlySet<AiErrorCategory> = new Set<AiErrorCategory>([
  "provider_rate_limit", // 429
  "provider_overloaded", // 529
  "provider_timeout",
  "provider_network",
  "provider_5xx",
])

export function isRetryableCategory(category: AiErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category)
}

/** Decide se um erro é retryable, devolvendo também a categoria (telemetria). */
export function classifyRetry(input: ClassifyAiErrorInput): RetryDecision {
  const reason = classifyAiError(input)
  return { retryable: isRetryableCategory(reason), reason }
}
