import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  aggregateCacheEvents,
  aiCacheEventSchema,
  buildCacheEventRecord,
  toCacheEventRow,
  type AiCacheEvent,
  type CacheEventMetrics,
  type RawCacheEventInput,
} from "@/lib/ai-cache"

/**
 * Grava UM evento de cache (best-effort). NUNCA lança nem bloqueia o fluxo
 * funcional: telemetria não pode derrubar a operação (plano §8.2, §19). Valida
 * com Zod antes de inserir; entrada inválida é descartada com warning.
 *
 * Importante: isto NÃO escreve em ai_api_calls — só na tabela dedicada
 * ai_cache_events (migration 107). Hits aqui não viram "chamada de custo zero".
 */
export async function recordCacheEvent(event: AiCacheEvent): Promise<void> {
  try {
    const parsed = aiCacheEventSchema.safeParse(event)
    if (!parsed.success) {
      console.warn("[ai-cache] evento inválido, descartado:", parsed.error.issues[0]?.message)
      return
    }
    const supabase = createAdminClient()
    const { error } = await supabase.from("ai_cache_events").insert(toCacheEventRow(parsed.data))
    if (error) console.warn("[ai-cache] insert de evento falhou:", error.message)
  } catch (err) {
    console.warn("[ai-cache] recordCacheEvent exception:", err instanceof Error ? err.message : err)
  }
}

/**
 * Dispara `recordCacheEvent` sem aguardar (fire-and-forget) — pro caminho de
 * leitura do cache, onde não queremos somar latência de telemetria ao hit.
 * A promise é silenciada (best-effort).
 */
export function recordCacheEventAsync(event: AiCacheEvent): void {
  void recordCacheEvent(event)
}

const SELECT_COLS =
  "created_at, operation, cache_layer, cache_status, is_resolution, cache_miss_reason, lookup_latency_ms"
const PAGE_SIZE = 1000

async function fetchCacheEventRows(
  sinceIso: string | null,
  operation?: string | null,
): Promise<RawCacheEventInput[]> {
  const supabase = createAdminClient()
  const all: RawCacheEventInput[] = []
  let from = 0
  for (;;) {
    let query = supabase
      .from("ai_cache_events")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (sinceIso) query = query.gte("created_at", sinceIso)
    if (operation) query = query.eq("operation", operation)
    const { data, error } = await query
    if (error) {
      // Tabela ainda não migrada (107 pendente) ou erro de leitura: degrada pra
      // vazio — o painel mostra "sem dados", não quebra.
      console.warn("[ai-cache] fetchCacheEventRows falhou:", error.message)
      break
    }
    const batch = (data ?? []) as unknown as RawCacheEventInput[]
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export interface CacheEventTotals {
  lookups: number
  hits: number
  misses: number
  bypasses: number
  errors: number
  dedupWaits: number
  providerCallsAvoided: number
  hitRate: number | null
}

export interface CacheEventsResult {
  /** true quando a leitura falhou (tabela ausente/erro) — painel mostra "não mensurável". */
  unavailable: boolean
  totalEvents: number
  totals: CacheEventTotals
  byOperation: CacheEventMetrics[]
}

function sumTotals(byOperation: CacheEventMetrics[]): CacheEventTotals {
  const t: CacheEventTotals = {
    lookups: 0, hits: 0, misses: 0, bypasses: 0, errors: 0, dedupWaits: 0, providerCallsAvoided: 0, hitRate: null,
  }
  for (const o of byOperation) {
    t.lookups += o.lookups
    t.hits += o.hits
    t.misses += o.misses
    t.bypasses += o.bypasses
    t.errors += o.errors
    t.dedupWaits += o.dedupWaits
    t.providerCallsAvoided += o.providerCallsAvoided
  }
  const denom = t.hits + t.misses
  t.hitRate = denom > 0 ? t.hits / denom : null
  return t
}

/** Lê + agrega os eventos de cache do período (dias; null = tudo). */
export async function getCacheEventMetrics(
  days: number | null,
  operation?: string | null,
): Promise<CacheEventsResult> {
  const sinceIso = days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString()
  const rows = await fetchCacheEventRows(sinceIso, operation)
  const records = rows.map(buildCacheEventRecord)
  const byOperation = aggregateCacheEvents(records)
  return {
    unavailable: rows.length === 0,
    totalEvents: records.length,
    totals: sumTotals(byOperation),
    byOperation,
  }
}
