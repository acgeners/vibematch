/**
 * Eventos de cache de resultado (Plano 2 §8/§9). Parte PURA: tipo + Zod + mapper
 * camelCase→snake_case + agregação. A escrita/leitura no banco (best-effort) fica
 * em server/queries/ai-cache.ts — aqui não há acesso a banco nem Date.now().
 */

import { z } from "zod"
import { AI_WORKLOAD_TYPES, type AiWorkloadType } from "@/lib/ai-observability/types"
import {
  AI_CACHE_EVENT_STATUSES,
  AI_CACHE_LAYERS,
  isCacheEventBypass,
  isCacheEventHit,
  isCacheEventMiss,
  type AiCacheEventStatus,
  type AiCacheLayer,
} from "./types"

// 'resolution' é uma camada lógica do EVENTO (não uma camada física de cache).
const EVENT_LAYERS = [...AI_CACHE_LAYERS, "resolution"] as const
export type AiCacheEventLayer = (typeof EVENT_LAYERS)[number]

export interface AiCacheEvent {
  logicalRequestId?: string | null
  operation: string
  workloadType?: AiWorkloadType | null
  cacheLayer: AiCacheEventLayer
  cacheStatus: AiCacheEventStatus
  /** true = evento FINAL da consulta (conta na taxa). false = camada intermediária. */
  isResolution?: boolean
  cacheMissReason?: string | null
  inputHash?: string | null
  modelName?: string | null
  promptVersion?: string | null
  outputSchemaVersion?: string | null
  workId?: string | null
  userId?: string | null
  lookupLatencyMs?: number | null
  metadata?: Record<string, unknown>
}

export const aiCacheEventSchema = z.object({
  logicalRequestId: z.string().nullish(),
  operation: z.string().min(1),
  workloadType: z.enum(AI_WORKLOAD_TYPES).nullish(),
  cacheLayer: z.enum(EVENT_LAYERS),
  cacheStatus: z.enum(AI_CACHE_EVENT_STATUSES),
  isResolution: z.boolean().optional(),
  cacheMissReason: z.string().nullish(),
  inputHash: z.string().nullish(),
  modelName: z.string().nullish(),
  promptVersion: z.string().nullish(),
  outputSchemaVersion: z.string().nullish(),
  workId: z.string().nullish(),
  userId: z.string().nullish(),
  lookupLatencyMs: z.number().int().nonnegative().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/** Linha pronta pro insert em ai_cache_events (snake_case). Pura. */
export function toCacheEventRow(event: AiCacheEvent): Record<string, unknown> {
  return {
    logical_request_id: event.logicalRequestId ?? null,
    operation: event.operation,
    workload_type: event.workloadType ?? "unknown",
    cache_layer: event.cacheLayer,
    cache_status: event.cacheStatus,
    is_resolution: event.isResolution ?? true,
    cache_miss_reason: event.cacheMissReason ?? null,
    input_hash: event.inputHash ?? null,
    model_name: event.modelName ?? null,
    prompt_version: event.promptVersion ?? null,
    output_schema_version: event.outputSchemaVersion ?? null,
    work_id: event.workId ?? null,
    user_id: event.userId ?? null,
    lookup_latency_ms: event.lookupLatencyMs ?? null,
    metadata: event.metadata ?? {},
  }
}

// ── Agregação (plano §9) ─────────────────────────────────────────────────────

/** Registro normalizado vindo de ai_cache_events (snake→camel). */
export interface AiCacheEventRecord {
  createdAt: string
  operation: string
  cacheLayer: AiCacheEventLayer
  cacheStatus: AiCacheEventStatus
  isResolution: boolean
  lookupLatencyMs: number | null
}

export interface RawCacheEventInput {
  created_at: string
  operation: string
  cache_layer: string
  cache_status: string
  is_resolution: boolean | null
  lookup_latency_ms: number | null
}

const EVENT_STATUS_SET = new Set<string>(AI_CACHE_EVENT_STATUSES)
const EVENT_LAYER_SET = new Set<string>(EVENT_LAYERS)

export function buildCacheEventRecord(raw: RawCacheEventInput): AiCacheEventRecord {
  return {
    createdAt: raw.created_at,
    operation: raw.operation,
    cacheLayer: (EVENT_LAYER_SET.has(raw.cache_layer) ? raw.cache_layer : "resolution") as AiCacheEventLayer,
    cacheStatus: (EVENT_STATUS_SET.has(raw.cache_status) ? raw.cache_status : "unknown") as AiCacheEventStatus,
    isResolution: raw.is_resolution ?? true,
    lookupLatencyMs: raw.lookup_latency_ms == null ? null : Number(raw.lookup_latency_ms),
  }
}

export interface CacheEventMetrics {
  operation: string
  /** Consultas RESOLVIDAS (is_resolution=true) — base honesta da taxa. */
  lookups: number
  hits: number
  misses: number
  bypasses: number
  errors: number
  /** hits / (hits + misses); null quando não há resoluções hit/miss. */
  hitRate: number | null
  /** Chamadas ao provider EVITADAS = hits resolvidos. */
  providerCallsAvoided: number
  layerHits: Record<AiCacheLayer, number>
  statusCounts: Record<string, number>
  lookupLatencyAvgMs: number | null
}

/** Agrega eventos de UMA operação. Só `is_resolution` entra na taxa. */
export function aggregateCacheEventGroup(
  operation: string,
  records: AiCacheEventRecord[],
): CacheEventMetrics {
  let hits = 0
  let misses = 0
  let bypasses = 0
  let errors = 0
  let lookups = 0
  const layerHits: Record<AiCacheLayer, number> = { memory: 0, persistent: 0 }
  const statusCounts: Record<string, number> = {}
  const latencies: number[] = []

  for (const r of records) {
    statusCounts[r.cacheStatus] = (statusCounts[r.cacheStatus] ?? 0) + 1
    // Hits por camada física contam mesmo em eventos intermediários (informativo).
    if (r.cacheStatus === "hit_memory") layerHits.memory += 1
    if (r.cacheStatus === "hit_persistent") layerHits.persistent += 1

    if (!r.isResolution) continue
    lookups += 1
    if (r.lookupLatencyMs != null && Number.isFinite(r.lookupLatencyMs)) latencies.push(r.lookupLatencyMs)
    if (isCacheEventHit(r.cacheStatus)) hits += 1
    else if (isCacheEventMiss(r.cacheStatus)) misses += 1
    else if (isCacheEventBypass(r.cacheStatus)) bypasses += 1
    else if (r.cacheStatus === "cache_error") errors += 1
  }

  const denom = hits + misses
  return {
    operation,
    lookups,
    hits,
    misses,
    bypasses,
    errors,
    hitRate: denom > 0 ? hits / denom : null,
    providerCallsAvoided: hits,
    layerHits,
    statusCounts,
    lookupLatencyAvgMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
  }
}

/** Uma linha por operação, ordenada por nº de lookups desc. */
export function aggregateCacheEvents(records: AiCacheEventRecord[]): CacheEventMetrics[] {
  const byOp = new Map<string, AiCacheEventRecord[]>()
  for (const r of records) {
    const list = byOp.get(r.operation) ?? []
    list.push(r)
    byOp.set(r.operation, list)
  }
  const out: CacheEventMetrics[] = []
  for (const [op, list] of byOp.entries()) out.push(aggregateCacheEventGroup(op, list))
  out.sort((a, b) => b.lookups - a.lookups || b.hits - a.hits)
  return out
}
