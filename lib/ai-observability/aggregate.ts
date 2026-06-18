/**
 * Agregações PURAS sobre as chamadas de IA (plano §10, §12, §13, §18).
 *
 * Princípios (alinhados ao audit / feedback de rigor):
 *  - ausência ≠ zero: latência null não entra nos percentis; sem sucesso →
 *    custo/sucesso é null, não 0;
 *  - distinguir SOLICITAÇÃO LÓGICA × TENTATIVA física: `attempts` = nº de linhas;
 *    `logicalRequests` = distinto de logical_request_id quando TODAS as linhas o
 *    têm, senão null + uma aproximação honesta (`logicalRequestsApprox`);
 *  - cache HIT do resultado curto-circuita antes do provider — só é contável se a
 *    instrumentação registrar o evento de hit (cache_status memory/db).
 *
 * Sem acesso a banco e sem Date.now() implícito. A ponte com Supabase
 * (RawRow → AiCallRecord) é `buildAiCallRecord`, também pura.
 */

import { classifyAiError } from "./classify-error"
import { classifyWorkload } from "./workload"
import { parseAiCallMetadata } from "./schemas"
import {
  isCacheHit,
  type AiCacheStatus,
  type AiErrorCategory,
  type AiImageStatus,
  type AiWorkloadType,
} from "./types"

// ── Registro normalizado de uma chamada ──────────────────────────────────────

export interface AiCallRecord {
  createdAt: string
  operation: string
  model: string
  promptVersion: string | null
  status: "success" | "error"
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  latencyMs: number | null
  errorCategory: AiErrorCategory | null
  workload: AiWorkloadType
  logicalRequestId: string | null
  attempt: number | null
  cacheStatus: AiCacheStatus | null
  imageStatus: AiImageStatus | null
}

/** Shape cru vindo de ai_api_calls (snake_case), desacoplado do tipo do Supabase. */
export interface RawAiCallInput {
  created_at: string
  operation: string
  model_name: string
  prompt_version: string | null
  status: "success" | "error"
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  cost_total_usd: number | string | null
  latency_ms: number | null
  error_message: string | null
  stop_reason: string | null
  metadata: Record<string, unknown> | null
}

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Constrói um AiCallRecord a partir de uma linha crua. Para linhas HISTÓRICAS
 * (sem os campos novos no metadata), deriva error_category da mensagem e
 * workload da operação — sem inventar dados (na dúvida → null/"unknown").
 */
export function buildAiCallRecord(raw: RawAiCallInput): AiCallRecord {
  const meta = parseAiCallMetadata(raw.metadata)

  const errorCategory =
    raw.status === "error"
      ? meta.error_category ??
        classifyAiError({ message: raw.error_message, stopReason: raw.stop_reason })
      : null

  return {
    createdAt: raw.created_at,
    operation: raw.operation,
    model: raw.model_name,
    promptVersion: raw.prompt_version,
    status: raw.status,
    inputTokens: toNum(raw.input_tokens),
    outputTokens: toNum(raw.output_tokens),
    cacheReadTokens: toNum(raw.cache_read_tokens),
    cacheCreationTokens: toNum(raw.cache_creation_tokens),
    costUsd: toNum(raw.cost_total_usd),
    latencyMs: raw.latency_ms == null ? null : Number(raw.latency_ms),
    errorCategory,
    workload: classifyWorkload({ operation: raw.operation, metadata: raw.metadata }),
    logicalRequestId: meta.logical_request_id ?? null,
    attempt: typeof meta.attempt === "number" ? meta.attempt : null,
    cacheStatus: meta.cache_status ?? null,
    imageStatus: meta.image_status ?? null,
  }
}

// ── Percentil (nearest-rank) ─────────────────────────────────────────────────

/** Percentil p∈[0,100] por nearest-rank. null se não houver valores finitos. */
export function percentile(values: number[], p: number): number | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  const sorted = [...finite].sort((a, b) => a - b)
  if (p <= 0) return sorted[0]!
  if (p >= 100) return sorted[sorted.length - 1]!
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[idx]!
}

// ── Métricas por grupo de operação ───────────────────────────────────────────

export interface OperationMetrics {
  operation: string
  attempts: number
  successes: number
  failures: number
  errorRate: number
  /** Distinto de logical_request_id; null quando nem toda linha tem id. */
  logicalRequests: number | null
  /** Aproximação honesta: linhas com attempt 0/null (super-conta image fallback). */
  logicalRequestsApprox: number
  /** attempts / logicalRequests (exato se disponível, senão sobre o approx). */
  attemptsPerLogicalRequest: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
  costPerAttempt: number | null
  costPerSuccess: number | null
  costPerLogicalRequest: number | null
  latencyAvgMs: number | null
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  latencyMaxMs: number | null
  byModel: Record<string, number>
  byPromptVersion: Record<string, number>
  byWorkload: Record<string, number>
  errorsByCategory: Record<string, number>
  cacheStatusCounts: Record<string, number>
}

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

/** Agrega um conjunto já filtrado de registros num único OperationMetrics. */
export function aggregateGroup(operation: string, records: AiCallRecord[]): OperationMetrics {
  let successes = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let costUsd = 0
  const latencies: number[] = []
  const byModel: Record<string, number> = {}
  const byPromptVersion: Record<string, number> = {}
  const byWorkload: Record<string, number> = {}
  const errorsByCategory: Record<string, number> = {}
  const cacheStatusCounts: Record<string, number> = {}

  const logicalIds = new Set<string>()
  let allHaveLogicalId = records.length > 0
  let approxLogical = 0

  for (const r of records) {
    if (r.status === "success") successes += 1
    inputTokens += r.inputTokens
    outputTokens += r.outputTokens
    cacheReadTokens += r.cacheReadTokens
    cacheCreationTokens += r.cacheCreationTokens
    costUsd += r.costUsd
    if (r.latencyMs != null && Number.isFinite(r.latencyMs)) latencies.push(r.latencyMs)
    inc(byModel, r.model)
    inc(byPromptVersion, r.promptVersion ?? "—")
    inc(byWorkload, r.workload)
    if (r.errorCategory) inc(errorsByCategory, r.errorCategory)
    if (r.cacheStatus) inc(cacheStatusCounts, r.cacheStatus)

    if (r.logicalRequestId) logicalIds.add(r.logicalRequestId)
    else allHaveLogicalId = false
    if (r.attempt == null || r.attempt === 0) approxLogical += 1
  }

  const attempts = records.length
  const failures = attempts - successes
  const logicalRequests = allHaveLogicalId ? logicalIds.size : null
  const denomLogical = logicalRequests ?? (approxLogical > 0 ? approxLogical : null)

  return {
    operation,
    attempts,
    successes,
    failures,
    errorRate: attempts > 0 ? failures / attempts : 0,
    logicalRequests,
    logicalRequestsApprox: approxLogical,
    attemptsPerLogicalRequest: denomLogical && denomLogical > 0 ? attempts / denomLogical : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    costUsd,
    costPerAttempt: attempts > 0 ? costUsd / attempts : null,
    costPerSuccess: successes > 0 ? costUsd / successes : null,
    costPerLogicalRequest: denomLogical && denomLogical > 0 ? costUsd / denomLogical : null,
    latencyAvgMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    latencyMaxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    byModel,
    byPromptVersion,
    byWorkload,
    errorsByCategory,
    cacheStatusCounts,
  }
}

/** Uma linha de OperationMetrics por operação, ordenada por custo desc. */
export function aggregateOperationMetrics(records: AiCallRecord[]): OperationMetrics[] {
  const byOp = new Map<string, AiCallRecord[]>()
  for (const r of records) {
    const list = byOp.get(r.operation) ?? []
    list.push(r)
    byOp.set(r.operation, list)
  }
  const out: OperationMetrics[] = []
  for (const [op, list] of byOp.entries()) out.push(aggregateGroup(op, list))
  out.sort((a, b) => b.costUsd - a.costUsd || b.attempts - a.attempts)
  return out
}

// ── Cache (resultado) ────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number
  misses: number
  bypasses: number
  /** hits / (hits + misses); null se não houver eventos de cache observáveis. */
  hitRate: number | null
  /** Linhas que efetivamente chamaram o provider (não-hit). */
  providerCalls: number
}

export function summarizeCacheMetrics(records: AiCallRecord[]): CacheMetrics {
  let hits = 0
  let misses = 0
  let bypasses = 0
  for (const r of records) {
    if (isCacheHit(r.cacheStatus)) hits += 1
    else if (r.cacheStatus === "miss") misses += 1
    else if (r.cacheStatus === "bypass") bypasses += 1
  }
  const denom = hits + misses
  return {
    hits,
    misses,
    bypasses,
    hitRate: denom > 0 ? hits / denom : null,
    providerCalls: records.filter((r) => !isCacheHit(r.cacheStatus)).length,
  }
}

// ── Comparação antes/depois (efeito do fix das capas, plano §18) ─────────────

export interface ImplementationPeriodComparison {
  cutoffIso: string
  before: OperationMetrics | null
  after: OperationMetrics | null
  /** Há amostra suficiente em AMBOS os lados? (limiar provisório). */
  hasSufficientSample: boolean
}

export const MIN_PERIOD_SAMPLE = 20

/**
 * Divide os registros de UMA operação por um corte temporal e agrega cada lado.
 * Não opina sobre significância — só separa e sinaliza amostra insuficiente.
 * `records` deve ser de uma única operação (filtre antes).
 */
export function compareImplementationPeriods(
  operation: string,
  records: AiCallRecord[],
  cutoffIso: string,
): ImplementationPeriodComparison {
  const cutoff = Date.parse(cutoffIso)
  const before: AiCallRecord[] = []
  const after: AiCallRecord[] = []
  for (const r of records) {
    const t = Date.parse(r.createdAt)
    if (!Number.isFinite(t)) continue
    if (t < cutoff) before.push(r)
    else after.push(r)
  }
  return {
    cutoffIso,
    before: before.length > 0 ? aggregateGroup(operation, before) : null,
    after: after.length > 0 ? aggregateGroup(operation, after) : null,
    hasSufficientSample: before.length >= MIN_PERIOD_SAMPLE && after.length >= MIN_PERIOD_SAMPLE,
  }
}
