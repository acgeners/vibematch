import "server-only"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  aggregateGroup,
  aggregateOperationMetrics,
  buildAiCallRecord,
  compareImplementationPeriods,
  percentile,
  summarizeCacheMetrics,
  AI_OPERATIONS,
  isKnownAiOperation,
  type AiCallRecord,
  type AiCacheStatus,
  type AiErrorCategory,
  type AiImageStatus,
  type AiWorkloadType,
  type CacheMetrics,
  type ImplementationPeriodComparison,
  type OperationMetrics,
} from "@/lib/ai-observability"

// ── Períodos (?range=) ───────────────────────────────────────────────────────
// Fonte única do seletor de período do painel. `days=null` = "Tudo" (sem corte).
// `chartDays` é a janela usada por gráficos/sparkline que precisam de um número
// finito de dias mesmo quando o período é "Tudo".

export const AI_USAGE_RANGES = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7 dias", days: 7 },
  { key: "30d", label: "30 dias", days: 30 },
  { key: "90d", label: "90 dias", days: 90 },
  { key: "all", label: "Tudo", days: null },
] as const

export type AiUsageRangeKey = (typeof AI_USAGE_RANGES)[number]["key"]

export interface ResolvedRange {
  key: AiUsageRangeKey
  label: string
  /** Corte em dias; null = período completo. */
  days: number | null
  /** Janela finita p/ gráficos diários/sparkline (days ?? 90). */
  chartDays: number
}

/** Resolve o `?range=` da URL num período conhecido (default 30d). */
export function resolveRange(input: string | null | undefined): ResolvedRange {
  const found = AI_USAGE_RANGES.find((r) => r.key === input) ?? AI_USAGE_RANGES[2]!
  return { key: found.key, label: found.label, days: found.days, chartDays: found.days ?? 90 }
}

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
  // ── Campos derivados (via buildAiCallRecord) p/ o detalhe do log ──
  workload: AiWorkloadType
  cacheStatus: AiCacheStatus | null
  imageStatus: AiImageStatus | null
  errorCategory: AiErrorCategory | null
  logicalRequestId: string | null
  attempt: number | null
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
  // Deriva workload/cache/image/erro do metadata — mesma lógica pura do diagnóstico.
  const rec = buildAiCallRecord(r)
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
    workload: rec.workload,
    cacheStatus: rec.cacheStatus,
    imageStatus: rec.imageStatus,
    errorCategory: rec.errorCategory,
    logicalRequestId: rec.logicalRequestId,
    attempt: rec.attempt,
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

// ── KPIs do período selecionado (range-aware, com delta vs. período anterior) ──
// Substitui as 4 janelas fixas na página /ai-usage: mostra custo/chamadas/lat.
// p95/erro DO período escolhido, comparados ao período imediatamente anterior de
// mesma duração + uma sparkline de custo diário. "Tudo" não tem período anterior.

export interface KpiMetric {
  cost: number
  calls: number
  tokens: number
  errorRate: number
  latencyP50: number | null
  latencyP95: number | null
}

export interface KpiDeltas {
  /** (cur − prev) / prev; null quando prev = 0 ou inexistente. */
  costPct: number | null
  callsPct: number | null
  /** Diferença absoluta de taxa (cur − prev), em fração 0–1. */
  errorRatePts: number | null
  latencyP95Pct: number | null
}

export interface AiUsageKpis {
  rangeDays: number | null
  current: KpiMetric
  previous: KpiMetric | null
  deltas: KpiDeltas | null
  /** Custo por dia dentro da janela atual (cronológico) — p/ sparkline. */
  sparkline: number[]
}

function kpiMetric(rows: RawRow[]): KpiMetric {
  const agg = aggregate(rows)
  const latencies = rows
    .map((r) => r.latency_ms)
    .filter((v): v is number => v != null && Number.isFinite(v))
  return {
    cost: agg.totalCostUsd,
    calls: agg.nCalls,
    tokens: agg.totalTokens,
    errorRate: agg.errorRate,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  }
}

function ratioDelta(cur: number, prev: number): number | null {
  return prev > 0 ? (cur - prev) / prev : null
}

/** Série de custo por dia (cronológica) para os últimos `days` dias. */
function dailyCostValues(rows: RawRow[], days: number): number[] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + Number(r.cost_total_usd ?? 0))
  }
  const out: number[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    out.push(byDay.get(d) ?? 0)
  }
  return out
}

export async function getAiUsageKpis(
  rangeDays: number | null,
  operation?: string | null,
): Promise<AiUsageKpis> {
  if (rangeDays == null) {
    // "Tudo": sem período anterior; sparkline dos últimos 90 dias.
    const rows = await fetchRows(null, operation)
    return {
      rangeDays: null,
      current: kpiMetric(rows),
      previous: null,
      deltas: null,
      sparkline: dailyCostValues(rows, 90),
    }
  }
  // Busca 2× a janela e divide em atual / anterior (mesma duração).
  const spanMs = rangeDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  const rows = await fetchRows(new Date(now - 2 * spanMs).toISOString(), operation)
  const curCutoff = now - spanMs
  const cur: RawRow[] = []
  const prev: RawRow[] = []
  for (const r of rows) {
    ;(new Date(r.created_at).getTime() >= curCutoff ? cur : prev).push(r)
  }
  const current = kpiMetric(cur)
  const previous = kpiMetric(prev)
  return {
    rangeDays,
    current,
    previous,
    deltas: {
      costPct: ratioDelta(current.cost, previous.cost),
      callsPct: ratioDelta(current.calls, previous.calls),
      errorRatePts: previous.calls > 0 ? current.errorRate - previous.errorRate : null,
      latencyP95Pct:
        previous.latencyP95 != null && current.latencyP95 != null
          ? ratioDelta(current.latencyP95, previous.latencyP95)
          : null,
    },
    sparkline: dailyCostValues(cur, rangeDays),
  }
}

export async function getAiUsageByModel(
  rangeDays: number | null,
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

interface OperatorSettingsRow {
  id: string
  anthropic_balance_usd: number | string | null
  anthropic_balance_set_at: string | null
}

const BALANCE_COLS = "id, anthropic_balance_usd, anthropic_balance_set_at"

/**
 * A linha de `user_settings` que guarda o saldo do OPERADOR — a marcada com
 * `is_operator` (migration 180).
 *
 * 🔴 **Leitura e escrita TÊM que resolver a MESMA linha, e por muito tempo não
 * resolviam.** A leitura pegava a linha mais antiga; a escrita (`setAnthropicBalance`)
 * usava um helper chamado `getSingletonId` que, apesar do nome, devolvia a linha do
 * usuário ATUAL. Para o dono as duas coincidem e nada aparece. Para um segundo curador,
 * a UI diz "salvo", o valor vai pra linha dele e a releitura devolve o do dono: o número
 * simplesmente não muda, sem erro e sem log.
 *
 * Por isso os dois caminhos passam por aqui — a pergunta "qual linha?" é respondida uma
 * vez só. O saldo é da conta Anthropic ÚNICA que banca o app inteiro (`global_config` em
 * `lib/plans/roles.ts`), não um dado pessoal; quando existir carteira POR USUÁRIO ela
 * será outra coluna, com outro dono, e não passa por aqui.
 *
 * ## Por que não há mais fallback pra "linha mais antiga"
 *
 * Havia um, enquanto a migration 180 não estava aplicada — as migrations aqui sobem à
 * mão, então existe sempre uma janela em que o código está no ar e a coluna não.
 * Confirmado na nuvem em 2026-08-07 (`is_operator` existe, 1 linha marcada, índice único
 * presente), ele saiu — e sair é o ponto, não a limpeza: enquanto existia, perder a marca
 * (restauração malfeita, `update` manual) fazia o app **voltar em silêncio** à convenção
 * que a migration veio justamente aposentar. O problema seguiria invisível, servindo o
 * valor certo pelo motivo errado, até o dia em que a linha mais antiga não fosse mais a do
 * operador.
 *
 * Agora "ninguém marcado" é estado ANÔMALO e **avisa**: o `console.warn` abaixo distingue
 * "não achei a linha" de "erro na consulta", que é a diferença entre configuração e
 * infraestrutura na hora de diagnosticar. Quem chama cai pro estado "saldo nunca
 * informado", que é o mesmo desfecho de sempre — só que agora com rastro.
 */
async function fetchOperatorSettingsRow(): Promise<OperatorSettingsRow | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("user_settings")
    .select(BALANCE_COLS)
    .eq("is_operator", true)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(`[ai-usage] saldo indisponível: ${error.message}`)
    return null
  }
  if (!data) {
    console.warn(
      "[ai-usage] nenhuma linha de user_settings com is_operator = true — o saldo do " +
        "operador não tem onde morar. Ver migration 180.",
    )
    return null
  }
  return data as OperatorSettingsRow
}

/**
 * id da linha onde o saldo do operador é GRAVADO — o par de escrita de
 * `getAnthropicBalanceStatus`. Existe para que `setAnthropicBalance` não precise
 * (nem possa) redescobrir por conta própria qual é a linha certa.
 */
export async function getOperatorSettingsId(): Promise<string | null> {
  return (await fetchOperatorSettingsRow())?.id ?? null
}

/**
 * Saldo Anthropic informado manualmente + quanto restou. Modelo snapshot
 * (migration 092): lê valor + instante da linha do operador e subtrai o custo das
 * chamadas desde aquele instante.
 *
 * ⚠️ O custo subtraído é GLOBAL (`fetchRows` não filtra por usuário), e está certo:
 * todas as chamadas do app saem da mesma conta Anthropic. Se um dia houver carteira
 * per-usuário, ela precisa do seu próprio abatimento — filtrado — e não deste.
 */
export async function getAnthropicBalanceStatus(): Promise<BalanceStatus> {
  const row = await fetchOperatorSettingsRow()
  if (!row) return EMPTY_BALANCE

  const rawBalance = row.anthropic_balance_usd
  const setAt = row.anthropic_balance_set_at ?? null
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
  rangeDays?: number | null,
): Promise<AiCallRow[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("ai_api_calls")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (operation) query = query.eq("operation", operation)
  const sinceIso = rangeStartIso(rangeDays ?? null)
  if (sinceIso) query = query.gte("created_at", sinceIso)
  const { data, error } = await query
  if (error) {
    console.error("[ai-usage] getRecentAiCalls falhou:", error.message)
    return []
  }
  return ((data ?? []) as unknown as RawRow[]).map(rowToCall)
}

// ── Custo de IA atribuído a UMA obra (widget dev-only da página da obra) ──────
// A obra é ligada à chamada por `metadata->>'work_id'` (não há coluna dedicada
// — ver migration 059). Some `cost_total_usd` de TODAS as chamadas dessa obra
// (inclui erros: uma tentativa que falhou também gastou tokens) e quebra por
// `operation`. Sem índice nesse campo JSONB, mas é 1 obra (dezenas de linhas) e
// só roda em dev. Ressalva: avaliações do fluxo de CRIAÇÃO (`/titles/new`) rodam
// antes de a obra existir (`work_id` nulo) e não são atribuídas aqui.

interface WorkCostRawRow {
  operation: string
  cost_total_usd: number | string | null
}

export interface WorkCostByOperation {
  operation: string
  /** Rótulo amigável de AI_OPERATIONS; cai pro próprio slug se desconhecido. */
  label: string
  nCalls: number
  totalCostUsd: number
}

export interface WorkAiCostSummary {
  totalCostUsd: number
  nCalls: number
  /** Quebra por operação, ordenada por custo desc. */
  byOperation: WorkCostByOperation[]
}

export async function getWorkAiCost(workId: string): Promise<WorkAiCostSummary> {
  const supabase = createAdminClient()
  const rows: WorkCostRawRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from("ai_api_calls")
      .select("operation, cost_total_usd")
      .eq("metadata->>work_id", workId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error("[ai-usage] getWorkAiCost falhou:", error.message)
      break
    }
    const batch = (data ?? []) as unknown as WorkCostRawRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  const byOp = new Map<string, { nCalls: number; totalCostUsd: number }>()
  let totalCostUsd = 0
  for (const r of rows) {
    const cost = Number(r.cost_total_usd ?? 0)
    totalCostUsd += cost
    const cur = byOp.get(r.operation) ?? { nCalls: 0, totalCostUsd: 0 }
    cur.nCalls += 1
    cur.totalCostUsd += cost
    byOp.set(r.operation, cur)
  }

  const byOperation: WorkCostByOperation[] = [...byOp.entries()]
    .map(([operation, agg]) => ({
      operation,
      label: isKnownAiOperation(operation) ? AI_OPERATIONS[operation].label : operation,
      nCalls: agg.nCalls,
      totalCostUsd: agg.totalCostUsd,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.nCalls - a.nCalls)

  return { totalCostUsd, nCalls: rows.length, byOperation }
}

// ============================================================================
// Baseline "criar uma obra do zero" (dev). Responde: dos $X que ESTA obra já
// gastou, quanto seria só o mínimo pra existir com todos os dados de catálogo?
// ============================================================================

/**
 * As operações de IA que uma criação do zero roda UMA vez cada. É a fase paga da
 * cascata `generateAllWorkData` (server/actions/generate-all.ts) traduzida de
 * `ActionName` (o vocabulário do orquestrador) para `operation` (o vocabulário do
 * log) — os dois nomes existem e não batem.
 *
 * 🔴 FORA de propósito, e é o ponto do pedido: `predict_interest_potential`
 * (→ `synopsis_quality_predict`) e `run_alignment` (→ `recommendation_rank`) são
 * PER-USUÁRIO — Interesse previsto e Veredito IA valem contra o perfil de gosto de
 * QUEM pergunta, não contra a obra. Somá-los aqui responderia "quanto custou pro
 * dono", não "quanto custa a obra existir". `generate_embedding` fica fora por ser
 * grátis (OpenAI ~$0).
 *
 * Se a cascata ganhar/perder um passo pago, esta lista tem que acompanhar — não há
 * como o TypeScript ligar as duas pontas (`ActionName` ≠ `AiOperationKey`).
 */
const FROM_SCRATCH_OPERATIONS = [
  "synopsis_consolidator",
  "review_summarizer",
  "review_digest",
  "tag_inference",
  "ai_evaluation",
] as const

/**
 * `tag_inference` NÃO carrega `metadata.work_id` (as 491 chamadas medidas em
 * 2026-07-27 têm só `nCandidates`/`withReviews`), então ela não pode ser agrupada
 * por obra como as outras. Vale como proxy porque é **uma chamada por obra**:
 * `inferTagsFromText` faz um único `createLoggedMessage` por execução
 * (lib/tags/infer-from-text.ts). Ou seja, aqui a mediana é POR CHAMADA — que, para
 * esta operação, é a mediana por obra.
 */
const OPERATIONS_WITHOUT_WORK_ID = new Set<string>(["tag_inference"])

export interface FromScratchBaselineOperation {
  operation: string
  label: string
  /** Mediana do custo da 1ª execução por obra (USD). */
  medianUsd: number
  /** Quantas obras (ou chamadas, quando não há work_id) entraram na mediana. */
  nSamples: number
}

export interface FromScratchBaseline {
  /** Soma das medianas das operações de catálogo. `null` = sem histórico. */
  totalUsd: number | null
  byOperation: FromScratchBaselineOperation[]
  /** Operações do baseline que ainda não têm nenhuma chamada registrada. */
  missingOperations: string[]
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Custo TÍPICO (mediana, não estimativa) de gerar do zero os dados de catálogo de
 * uma obra. Mede o que já aconteceu de verdade em `ai_api_calls`, então acompanha
 * sozinho mudanças de modelo e de prompt — ao contrário do `estimateStepUsd` do
 * checkpoint, que é upper bound com margem 1,5× (mediu ~$0,13 contra ~$0,07 reais).
 *
 * "Primeira execução" por obra = as chamadas do PRIMEIRO DIA em que aquela operação
 * rodou para aquela obra. Somar o dia inteiro (em vez de pegar uma chamada só) é o
 * que faz a retentativa e o digest em pedaços contarem — eles são parte do custo de
 * gerar aquilo uma vez. Reavaliações posteriores ("Reavaliar com Opus", A/B) ficam
 * de fora, que é o ponto: elas não são criar do zero.
 *
 * Chamadas com ERRO entram (gastaram tokens de verdade). Roda só em dev — a soma
 * paginada varre ~2,7 mil linhas.
 */
export async function getFromScratchBaselineCost(): Promise<FromScratchBaseline> {
  const supabase = createAdminClient()
  const rows: Array<{
    operation: string
    cost_total_usd: number | string | null
    created_at: string
    work_id: string | null
  }> = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ai_api_calls")
      // `work_id:metadata->>work_id` puxa só o campo do JSONB — o metadata inteiro
      // seria ~10× o payload sem nenhum leitor aqui.
      .select("operation, cost_total_usd, created_at, work_id:metadata->>work_id")
      .in("operation", FROM_SCRATCH_OPERATIONS as unknown as string[])
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error("[ai-usage] getFromScratchBaselineCost falhou:", error.message)
      return { totalUsd: null, byOperation: [], missingOperations: [] }
    }
    const batch = (data ?? []) as unknown as typeof rows
    rows.push(...batch)
    // ⚠️ Paginado: o select corta em 1000 linhas SEM AVISAR, e um recorte aqui não
    // dá erro — dá uma mediana errada, que é pior.
    if (batch.length < PAGE_SIZE) break
  }

  const byOperation: FromScratchBaselineOperation[] = []
  const missingOperations: string[] = []

  for (const operation of FROM_SCRATCH_OPERATIONS) {
    const calls = rows.filter((r) => r.operation === operation)
    const label = isKnownAiOperation(operation) ? AI_OPERATIONS[operation].label : operation

    let samples: number[]
    if (OPERATIONS_WITHOUT_WORK_ID.has(operation)) {
      samples = calls.map((c) => Number(c.cost_total_usd ?? 0))
    } else {
      // Agrupa por obra e soma o primeiro DIA de execução (retries + chamadas em pedaços).
      const firstRunByWork = new Map<string, { day: string; total: number }>()
      for (const call of calls) {
        if (!call.work_id) continue
        const day = String(call.created_at).slice(0, 10)
        const acc = firstRunByWork.get(call.work_id)
        // `rows` vem ordenado por created_at asc ⇒ o primeiro dia visto é o primeiro dia.
        if (!acc) firstRunByWork.set(call.work_id, { day, total: Number(call.cost_total_usd ?? 0) })
        else if (acc.day === day) acc.total += Number(call.cost_total_usd ?? 0)
      }
      samples = [...firstRunByWork.values()].map((v) => v.total)
    }

    const usable = samples.filter((v) => v > 0)
    if (usable.length === 0) {
      missingOperations.push(label)
      continue
    }
    byOperation.push({ operation, label, medianUsd: medianOf(usable), nSamples: usable.length })
  }

  return {
    // Sem NENHUMA operação medida não existe baseline — `0` seria uma resposta
    // falsa ("criar uma obra é de graça"), então devolve null e a UI omite a linha.
    totalUsd: byOperation.length === 0 ? null : byOperation.reduce((s, o) => s + o.medianUsd, 0),
    byOperation,
    missingOperations,
  }
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
  /** Corte em dias; null = período completo ("Tudo"). */
  rangeDays: number | null
  generatedAtIso: string
  /** Métricas por operação (ordenadas por custo desc). */
  operations: OperationMetrics[]
  /** Tudo somado no período. */
  overall: OperationMetrics
  /** Cache de RESULTADO (hits só aparecem após a instrumentação do Commit 2). */
  cache: CacheMetrics
}

export async function getAiOperationDiagnostics(
  rangeDaysInput: number | null = 30,
): Promise<AiOperationDiagnostics> {
  // null = "Tudo" (sem corte); qualquer número passa pela validação (1..365).
  const rangeDays = rangeDaysInput == null ? null : rangeDaysSchema.parse(rangeDaysInput)
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
