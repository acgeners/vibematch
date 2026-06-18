/**
 * Schemas Zod do "saco" de metadata gravado em ai_api_calls.metadata (JSONB).
 *
 * Decisão de arquitetura (aprovada): NÃO há migration. Os campos novos de
 * observabilidade vivem no JSONB existente. Este schema valida/normaliza esse
 * saco na LEITURA (server/queries/ai-usage.ts) e documenta o que a
 * instrumentação (Commit 2) pode escrever.
 *
 * Tolerante por princípio: metadata é best-effort; campos inválidos/ausentes
 * viram undefined em vez de derrubar a leitura. `.passthrough()` preserva os
 * campos legados (work_id, run_id, attempt, hasImage, hasReviews, isOverride…).
 */

import { z } from "zod"
import {
  AI_CACHE_STATUSES,
  AI_ERROR_CATEGORIES,
  AI_IMAGE_STATUSES,
  AI_WORKLOAD_TYPES,
} from "./types"

const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined)

const optBool = z.boolean().optional().catch(undefined)
const optStr = z.string().optional().catch(undefined)
const optNum = z.number().optional().catch(undefined)

export const aiCallMetadataSchema = z
  .object({
    // ── Observabilidade (novos; escritos pela instrumentação) ──
    logical_request_id: optStr,
    workload_type: optEnum(AI_WORKLOAD_TYPES),
    cache_status: optEnum(AI_CACHE_STATUSES),
    cache_hit: optBool,
    error_category: optEnum(AI_ERROR_CATEGORIES),
    image_status: optEnum(AI_IMAGE_STATUSES),
    image_fallback_reason: optStr,
    // ── Legados (já existentes nos call sites) ──
    work_id: optStr,
    run_id: optStr,
    attempt: optNum,
    has_image: optBool,
    hasImage: optBool,
    has_reviews: optBool,
    hasReviews: optBool,
    is_override: optBool,
    isOverride: optBool,
    backfill: optBool,
  })
  .passthrough()

export type AiCallMetadata = z.infer<typeof aiCallMetadataSchema>

/**
 * Lê o metadata cru (objeto/null) de forma tolerante. Nunca lança: entrada
 * inválida → objeto vazio.
 */
export function parseAiCallMetadata(raw: unknown): AiCallMetadata {
  if (raw == null || typeof raw !== "object") return {}
  const result = aiCallMetadataSchema.safeParse(raw)
  return result.success ? result.data : {}
}
