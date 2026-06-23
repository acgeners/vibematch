import "server-only"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  aggregateGroup,
  aggregateOperationMetrics,
  buildAiCallRecord,
  compareImplementationPeriods,
  summarizeCacheMetrics,
  type AiCallRecord,
  type CacheMetrics,
  type ImplementationPeriodComparison,
  type OperationMetrics,
} from "@/lib/ai-observability"

export interface UsageAggregate {
  nCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number | null
  errorRate: number
}

export interface OperationAggregate extends UsageAggregate {
  operation: string
}

export interface ModelAggregate extends UsageAggregate {
  modelName: string
}

export interface AiCallRow {
  id: string
  createdAt: string
  operation: string
  subOperation: string | null
  modelName: string
  promptVersion: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCostUsd: number
  latencyMs: number
  status: "success" | "error"
  errorMessage: string | null
  stopReason: string | null
  metadata: Record<string, unknown> | null
}

interface RawRow {
  id: string
  created_at: string
  operation: string
  sub_operation: string | null
  model_name: string
  prompt_version: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  cost_total_usd: number | string | null
  latency_ms: number | null
  status: "success" | "error"
  error_message: string | null
  stop_reason: string | null
  metadata: Record<string, unknown> | null
}

function rowToCall(r: RawRow): AiCallRow {
  const input = r.input_tokens ?? 0
  const output = r.output_tokens ?? 0
  const cacheRead = r.cache_read_tokens ?? 0
  const cacheCreate = r.cache_creation_tokens ?? 0
  return {
    id: r.id,
    createdAt: r.created_at,
    operation: r.operation,
    subOperation: r.sub_operation,
    modelName: r.model_name,
    promptVersion: r.prompt_version,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    totalTokens: input + output + cacheRead + cacheCreate,
    totalCostUsd: Number(r.cost_total_usd ?? 0),
    latencyMs: r.latency_ms ?? 0,
    status: r.status,
    errorMessage: r.error_message,
    stopReason: r.stop_reason,
    metadata: r.metadata,
  }
}

function emptyAggregate(): UsageAggregate {
  return {
    nCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    avgLatencyMs: null,
    errorRate: 0,
  }
}

function aggregate(rows: RawRow[]): UsageAggregate {
  if (rows.length === 0) return emptyAggregate()
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let totalCostUsd = 0
  let totalLatencyMs = 0
  let errors = 0
  for (const r of rows) {
    inputTokens += r.input_tokens ?? 0
    outputTokens += r.output_tokens ?? 0
    cacheReadTokens += r.cache_read_tokens ?? 0
    cacheCreationTokens += r.cache_creation_tokens ?? 0
    totalCostUsd += Number(r.cost_total_usd ?? 0)
    totalLatencyMs += r.latency_ms ?? 0
    if (r.status === "error") errors += 1
  }
  return {
    nCalls: rows.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    totalCostUsd,
    avgLatencyMs: rows.length > 0 ? Math.round(totalLatencyMs / rows.length) : null,
    errorRate: errors / rows.length,
  }
}

const SELECT_COLS =
  "id, created_at, operation, sub_operation, model_name, prompt_version, " +
  "input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, " +
  "cost_total_usd, latency_ms, status, error_message, stop_reason, metadata"

// Supabase limita cada resposta a `db.maxRows` (default 1000). Sem paginação,
// os agregados ficavam silenciosamente truncados nas 1000 chamadas mais recentes
// — totais/custos apareciam muito abaixo do real e "encolhiam" conforme novas
// linhas empurravam as antigas pra fora da janela. Paginamos até esgotar.
const PAGE_SIZE = 1000

async function fetchRows(sinceIso: string | null, operation?: string | null): Promise<RawRow[]> {
  const supabase = createAdminClient()
  const all: RawRow[] = []
  let from = 0
  for (;;) {
    let query = supabase
      .from("ai_api_calls")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (sinceIso) query = query.gte("created_at", sinceIso)
    if (operation) query = query.eq("operation", operation)
    const { data, error } = await query
    if (error) {
      console.error("[ai-usage] fetchRows falhou:", error.message)
      break
    }
    const batch = (data ?? []) as unknown as RawRow[]
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function rangeStartIso(days: number | null): string | null {
  if (days == null) return null
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function getAiUsageTotals(operation?: string | null): Promise<{
  allTime: UsageAggregate
  last30d: UsageAggregate
  last7d: UsageAggregate
  last24h: UsageAggregate
}> {
  const allTime = await fetchRows(null, operation)
  const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000
  const cutoff7 = Date.now() - 7 * 24 * 60 * 60 * 1000
  const cutoff24 = Date.now() - 24 * 60 * 60 * 1000
  const within = (iso: string, cutoff: number) => new Date(iso).getTime() >= cutoff
  return {
    allTime: aggregate(allTime),
    last30d: aggregate(allTime.filter((r) => within(r.created_at, cutoff30))),
    last7d: aggregate(allTime.filter((r) => within(r.created_at, cutoff7))),
    last24h: aggregate(allTime.filter((r) => within(r.created_at, cutoff24))),
  }
}

export async function getAiUsageByOperation(rangeDays: number): Promise<OperationAggregate[]> {
  const rows = await fetchRows(rangeStartIso(rangeDays))
  const byOp = new Map<string, RawRow[]>()
  for (const r of rows) {
    const list = byOp.get(r.operation) ?? []
    list.push(r)
    byOp.set(r.operation, list)
  }
  const result: OperationAggregate[] = []
  for (const [operation, opRows] of byOp.entries()) {
    result.push({ operation, ...aggregate(opRows) })
  }
  result.sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.nCalls - a.nCalls)
  return result
}

export async function getAiUsageByModel(
  rangeDays: number,
  operation?: string | null,
): Promise<ModelAggregate[]> {
  const rows = await fetchRows(rangeStartIso(rangeDays), operation)
  const byModel = new Map<string, RawRow[]>()
  for (const r of rows) {
    const list = byModel.get(r.model_name) ?? []
    list.push(r)
    byModel.set(r.model_name, list)
  }
  const result: ModelAggregate[] = []
  for (const [modelName, mRows] of byModel.entries()) {
    result.push({ modelName, ...aggregate(mRows) })
  }
  result.sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.nCalls - a.nCalls)
  return result
}

export interface DailyUsagePoint {
  day: string
  cost: number
  calls: number
}

export async function getAiUsageDailySeries(
  rangeDays = 30,
  operation?: string | null,
): Promise<DailyUsagePoint[]> {
  const rows = await fetchRows(rangeStartIso(rangeDays), operation)
  const byDay = new Map<string, { cost: number; calls: number }>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    const cur = byDay.get(day) ?? { cost: 0, calls: 0 }
    cur.cost += Number(r.cost_total_usd ?? 0)
    cur.calls += 1
    byDay.set(day, cur)
  }
  const result: DailyUsagePoint[] = []
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const cur = byDay.get(d) ?? { cost: 0, calls: 0 }
    result.push({ day: d, cost: cur.cost, calls: cur.calls })
  }
  return result
}

export interface BalanceStatus {
  balanceUsd: number | null // valor informado (snapshot)
  setAt: string | null // ISO de quando foi informado
  spentSinceUsd: number // Σ cost_total_usd desde setAt
  remainingUsd: number | null // balanceUsd − spentSinceUsd (null se nunca informado)
  callsSince: number // nº de chamadas desde setAt
}

const EMPTY_BALANCE: BalanceStatus = {
  balanceUsd: null,
  setAt: null,
  spentSinceUsd: 0,
  remainingUsd: null,
  callsSince: 0,
}

/**
 * Saldo Anthropic informado manualmente + quanto restou. Modelo snapshot
 * (migration 092): lê valor + instante do singleton user_settings e subtrai
 * o custo das chamadas desde aquele instante. Tolerante a colunas ausentes
 * (mesma estratégia de getCurrentUserProfile) → cai pro estado "nunca informado".
 */
export async function getAnthropicBalanceStatus(): Promise<BalanceStatus> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("user_settings")
    .select("anthropic_balance_usd, anthropic_balance_set_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(`[ai-usage] saldo indisponível (colunas ausentes?): ${error.message}`)
    return EMPTY_BALANCE
  }

  const rawBalance = data?.anthropic_balance_usd
  const setAt = (data?.anthropic_balance_set_at as string | null | undefined) ?? null
  if (rawBalance == null || setAt == null) return EMPTY_BALANCE

  const balanceUsd = Number(rawBalance)
  // Janela pequena: só as chamadas desde o último rebaseamento. Reaproveita o
  // fetch paginado + agregação do resto do módulo.
  const since = aggregate(await fetchRows(setAt))
  const spentSinceUsd = since.totalCostUsd
  return {
    balanceUsd,
    setAt,
    spentSinceUsd,
    remainingUsd: balanceUsd - spentSinceUsd,
    callsSince: since.nCalls,
  }
}

export async function getRecentAiCalls(
  limit: number,
  operation?: string | null,
): Promise<AiCallRow[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("ai_api_calls")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (operation) query = query.eq("operation", operation)
  const { data, error } = await query
  if (error) {
    console.error("[ai-usage] getRecentAiCalls falhou:", error.message)
    return []
  }
  return ((data ?? []) as unknown as RawRow[]).map(rowToCall)
}

// ============================================================================
// Diagnóstico de operações (Plano 1 — Fase B). Reusa o fetch paginado e delega
// TODA a matemática às funções puras de lib/ai-observability. Distingue
// solicitação lógica × tentativa, custo por sucesso, p50/p95, categoria de erro
// e workload — métricas que os agregados legados (acima) não expõem.
// ============================================================================

/** Instante do merge do fix das capas (commit e9d0c70, base64 server-side). */
export const COVER_FIX_CUTOFF_ISO = "2026-06-17T22:43:54.000Z"

const rangeDaysSchema = z.number().int().positive().max(365).default(30)

function recordsFromRows(rows: RawRow[]): AiCallRecord[] {
  return rows.map((r) => buildAiCallRecord(r))
}

export interface AiOperationDiagnostics {
  rangeDays: number
  generatedAtIso: string
  /** Métricas por operação (ordenadas por custo desc). */
  operations: OperationMetrics[]
  /** Tudo somado no período. */
  overall: OperationMetrics
  /** Cache de RESULTADO (hits só aparecem após a instrumentação do Commit 2). */
  cache: CacheMetrics
}

export async function getAiOperationDiagnostics(
  rangeDaysInput = 30,
): Promise<AiOperationDiagnostics> {
  const rangeDays = rangeDaysSchema.parse(rangeDaysInput)
  const rows = await fetchRows(rangeStartIso(rangeDays))
  const records = recordsFromRows(rows)
  return {
    rangeDays,
    generatedAtIso: new Date().toISOString(),
    operations: aggregateOperationMetrics(records),
    overall: aggregateGroup("*", records),
    cache: summarizeCacheMetrics(records),
  }
}

export interface CoverFixReport {
  cutoffIso: string
  comparison: ImplementationPeriodComparison
  /** Avaliações registradas APÓS o corte (0 = ainda não mensurável). */
  afterCount: number
}

/**
 * Comparação antes/depois do fix das capas (plano §18). Honesta: se não há
 * amostra depois do corte (caso atual — o fix é mais novo que toda a base),
 * `afterCount` = 0 e a UI mostra "ainda não mensurável".
 */
export async function getCoverFixReport(
  cutoffIso: string = COVER_FIX_CUTOFF_ISO,
): Promise<CoverFixReport> {
  const rows = await fetchRows(null, "ai_evaluation")
  const records = recordsFromRows(rows)
  const comparison = compareImplementationPeriods("ai_evaluation", records, cutoffIso)
  return {
    cutoffIso,
    comparison,
    afterCount: comparison.after?.attempts ?? 0,
  }
}
