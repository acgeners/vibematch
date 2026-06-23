/**
 * Tipos do cache de RESULTADO das chamadas de IA (Plano 2 — confiabilidade).
 *
 * Tudo aqui é PURO e independente de banco. Convive com — não substitui — a
 * taxonomia do Plano 1 (`lib/ai-observability/types.ts`):
 *
 *  - `AiCacheStatus` (observabilidade) = "memory" | "db" | "miss" | "bypass",
 *    gravado em `ai_api_calls.metadata.cache_status` SÓ nas linhas que foram ao
 *    provider (sempre "miss"/"bypass", pois HITS curto-circuitam o logger).
 *  - `AiCacheEventStatus` (ESTE módulo) = o status RICO de uma consulta ao cache,
 *    gravado na tabela dedicada `ai_cache_events` (migration 107). É aqui que os
 *    HITS finalmente aparecem, sem poluir custo/latência de `ai_api_calls`.
 */

// ── Cacheabilidade de uma operação (plano §5) ────────────────────────────────

export const AI_CACHEABILITIES = [
  "content_addressable", // resultado depende só do conteúdo + versões
  "context_addressable", // conteúdo + contexto explícito (perfil, etc.)
  "session_scoped", // depende de histórico/sessão
  "not_cacheable", // não deve ser reutilizado por semântica
  "unknown", // ainda não provado
] as const

export type AiCacheability = (typeof AI_CACHEABILITIES)[number]

// ── Camada do cache ──────────────────────────────────────────────────────────

export const AI_CACHE_LAYERS = ["memory", "persistent"] as const
export type AiCacheLayer = (typeof AI_CACHE_LAYERS)[number]

// ── Status RICO de uma consulta ao cache (plano §8.1) ────────────────────────
// Usar APENAS motivos comprováveis. Quando a causa não puder ser determinada →
// "unknown" (NUNCA inventar um motivo).

export const AI_CACHE_EVENT_STATUSES = [
  "hit_memory",
  "hit_persistent",
  "miss_not_found",
  "miss_input_changed",
  "miss_prompt_changed",
  "miss_model_changed",
  "miss_schema_changed",
  "miss_expired",
  "miss_previous_error",
  "bypass_manual",
  "bypass_experiment",
  "bypass_force_refresh",
  "cache_error",
  "unknown",
] as const

export type AiCacheEventStatus = (typeof AI_CACHE_EVENT_STATUSES)[number]

export function isCacheEventHit(status: AiCacheEventStatus | null | undefined): boolean {
  return status === "hit_memory" || status === "hit_persistent"
}

export function isCacheEventMiss(status: AiCacheEventStatus | null | undefined): boolean {
  return (
    status === "miss_not_found" ||
    status === "miss_input_changed" ||
    status === "miss_prompt_changed" ||
    status === "miss_model_changed" ||
    status === "miss_schema_changed" ||
    status === "miss_expired" ||
    status === "miss_previous_error"
  )
}

export function isCacheEventBypass(status: AiCacheEventStatus | null | undefined): boolean {
  return (
    status === "bypass_manual" ||
    status === "bypass_experiment" ||
    status === "bypass_force_refresh"
  )
}

// ── Motivo de bypass explícito (plano §18) ───────────────────────────────────

export const AI_CACHE_BYPASS_REASONS = [
  "manual_refresh",
  "experiment",
  "data_repair",
  "prompt_migration",
  "model_migration",
  "admin_backfill",
  "unknown",
] as const

export type AiCacheBypassReason = (typeof AI_CACHE_BYPASS_REASONS)[number]

// ── Entrada da chave canônica (plano §6) ─────────────────────────────────────

export interface AiCacheKeyInput {
  /** Operação (mesma chave de `ai_api_calls.operation`). */
  operation: string
  /** Conteúdo que determina o resultado. Será canonicalizado. */
  input: unknown
  /** Modelo efetivo (entra na chave: modelos diferentes ⇒ chaves diferentes). */
  model: string
  /** Versão do prompt (null = sem versão; difere de "" e de ausente). */
  promptVersion: string | null
  /** Versão do schema de saída (null = não versionado). */
  outputSchemaVersion: string | null
  /** Parâmetros que INFLUENCIAM o output (temperature, thinking…). */
  relevantParameters?: Record<string, unknown>
  /** Feature flags relevantes ao resultado. */
  featureFlags?: Record<string, unknown>
}
