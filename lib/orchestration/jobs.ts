/**
 * Rastreio de jobs assíncronos (Fase B passo 1, decisão D4) — ver
 * ARQUITETURA-ORQUESTRACAO.md §4/§5.
 *
 * Dois back-ends por trás da mesma interface `JobStore`:
 *  - SupabaseJobStore: durável (tabela `work_processing_jobs`, migration 110).
 *    Dedup cross-processo via índice único parcial em `dedup_key`; ciclo
 *    queued→running→succeeded/failed; RETOMADA de jobs `failed` reusando a mesma
 *    linha e incrementando `attempts`; telemetria de custo/erro/timestamps.
 *  - InMemoryJobStore: FALLBACK quando a tabela ainda não existe + usado nos
 *    testes. Mesma semântica, dedup só no processo atual.
 *
 * `getJobStore()` sonda a tabela uma vez por processo e escolhe o back-end —
 * degradação graciosa idêntica ao padrão tolerante de `recalc_pending`.
 *
 * `runOrchestratedJob()` combina dedup durável (claim) com single-flight
 * em-processo (await compartilhado) e dirige o ciclo de vida — o executor chama
 * só esta função.
 */

import "server-only"
import { randomUUID } from "node:crypto"
import { runSingleFlight } from "@/lib/ai-cache/single-flight"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionName } from "./contracts"

type AdminClient = ReturnType<typeof createAdminClient>

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "skipped"

export interface JobRecord {
  id: string
  action: ActionName
  workId: string | null
  dedupKey: string
  status: JobStatus
  attempts: number
  costEstimateUsd: number | null
  costActualUsd: number | null
  errorCategory: string | null
  lastError: string | null
  /** Mínimo p/ retomada (IDs/hashes/versões). NUNCA conteúdo sensível/grande. */
  payload: Record<string, unknown> | null
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface ClaimInput {
  action: ActionName
  workId: string | null
  dedupKey: string
  estimateUsd?: number
  /** Mínimo p/ retomada (IDs/hashes/versões). NUNCA reviews/prompts/outputs/secrets. */
  payload?: Record<string, unknown> | null
}

export type ClaimResult =
  | { kind: "claimed"; job: JobRecord; resumed: boolean }
  | { kind: "active"; job: JobRecord }

export interface JobStore {
  /** Reivindica a execução. `active` = já há um job em voo com o mesmo dedup_key. */
  claim(input: ClaimInput): Promise<ClaimResult>
  /** queued → running. */
  markRunning(id: string): Promise<void>
  markSucceeded(id: string, patch?: { costActualUsd?: number | null }): Promise<void>
  markFailed(id: string, patch?: { errorCategory?: string | null; lastError?: string | null }): Promise<void>
}

// ---- Sanitização de erro ---------------------------------------------------

/**
 * Mensagem de erro segura p/ persistir em `last_error`: só a message (sem stack),
 * em uma linha, truncada, com redação de padrões óbvios de segredo (api keys,
 * JWT, bearer). NÃO é detecção exaustiva — é uma rede de segurança contra vazar
 * credencial num campo logado.
 */
export function sanitizeErrorMessage(err: unknown, maxLen = 500): string {
  const raw = err instanceof Error ? err.message : String(err)
  let s = raw.replace(/\s+/g, " ").trim()
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{10,}|[Bb]earer\s+[A-Za-z0-9._-]{8,})/g, "[REDACTED]")
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`
  return s
}

// ---- In-memory (fallback + testes) ----------------------------------------

export class InMemoryJobStore implements JobStore {
  /** Histórico completo — telemetria/asserções de teste. */
  readonly records: JobRecord[] = []

  private latest(dedupKey: string): JobRecord | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].dedupKey === dedupKey) return this.records[i]
    }
    return null
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const existing = this.latest(input.dedupKey)
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { kind: "active", job: existing }
    }
    if (existing && existing.status === "failed") {
      // Retomada: reusa a MESMA linha e incrementa attempts.
      existing.status = "queued"
      existing.attempts += 1
      existing.lastError = null
      existing.errorCategory = null
      existing.startedAt = null
      existing.finishedAt = null
      existing.costEstimateUsd = input.estimateUsd ?? existing.costEstimateUsd
      existing.payload = input.payload ?? existing.payload
      return { kind: "claimed", job: existing, resumed: true }
    }
    const job: JobRecord = {
      id: randomUUID(),
      action: input.action,
      workId: input.workId,
      dedupKey: input.dedupKey,
      status: "queued",
      attempts: 1,
      costEstimateUsd: input.estimateUsd ?? null,
      costActualUsd: null,
      errorCategory: null,
      lastError: null,
      payload: input.payload ?? null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    }
    this.records.push(job)
    return { kind: "claimed", job, resumed: false }
  }

  async markRunning(id: string): Promise<void> {
    const job = this.records.find((r) => r.id === id)
    if (!job || job.status !== "queued") return
    job.status = "running"
    job.startedAt = new Date().toISOString()
  }

  async markSucceeded(id: string, patch?: { costActualUsd?: number | null }): Promise<void> {
    const job = this.records.find((r) => r.id === id)
    if (!job) return
    job.status = "succeeded"
    job.costActualUsd = patch?.costActualUsd ?? job.costActualUsd
    job.finishedAt = new Date().toISOString()
  }

  async markFailed(
    id: string,
    patch?: { errorCategory?: string | null; lastError?: string | null },
  ): Promise<void> {
    const job = this.records.find((r) => r.id === id)
    if (!job) return
    job.status = "failed"
    job.errorCategory = patch?.errorCategory ?? null
    job.lastError = patch?.lastError ?? null
    job.finishedAt = new Date().toISOString()
  }
}

// ---- Supabase (durável) ----------------------------------------------------

const TABLE = "work_processing_jobs"
const ACTIVE_STATUSES: JobStatus[] = ["queued", "running"]

function mapRow(row: Record<string, unknown>): JobRecord {
  return {
    id: row.id as string,
    action: row.action as ActionName,
    workId: (row.work_id as string | null) ?? null,
    dedupKey: row.dedup_key as string,
    status: row.status as JobStatus,
    attempts: Number(row.attempts ?? 0),
    costEstimateUsd: row.cost_estimate_usd != null ? Number(row.cost_estimate_usd) : null,
    costActualUsd: row.cost_actual_usd != null ? Number(row.cost_actual_usd) : null,
    errorCategory: (row.error_category as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
  }
}

export class SupabaseJobStore implements JobStore {
  constructor(private readonly supabase: AdminClient) {}

  private async latest(dedupKey: string): Promise<JobRecord | null> {
    const { data } = await this.supabase
      .from(TABLE)
      .select("*")
      .eq("dedup_key", dedupKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? mapRow(data as Record<string, unknown>) : null
  }

  private async activeFor(dedupKey: string): Promise<JobRecord | null> {
    const { data } = await this.supabase
      .from(TABLE)
      .select("*")
      .eq("dedup_key", dedupKey)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? mapRow(data as Record<string, unknown>) : null
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const existing = await this.latest(input.dedupKey)

    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { kind: "active", job: existing }
    }

    // Retomada de um job FALHO: reusa a linha, incrementa attempts, requeue.
    // O índice único parcial garante que só uma transição failed→queued vence.
    if (existing && existing.status === "failed") {
      const { data: reclaimed } = await this.supabase
        .from(TABLE)
        .update({
          status: "queued",
          attempts: existing.attempts + 1,
          last_error: null,
          error_category: null,
          started_at: null,
          finished_at: null,
          cost_estimate_usd: input.estimateUsd ?? existing.costEstimateUsd,
          payload: input.payload ?? existing.payload ?? null,
        })
        .eq("id", existing.id)
        .eq("status", "failed")
        .select("*")
        .maybeSingle()
      if (reclaimed) return { kind: "claimed", job: mapRow(reclaimed as Record<string, unknown>), resumed: true }
      // Corrida: outro processo retomou primeiro.
      const active = await this.activeFor(input.dedupKey)
      if (active) return { kind: "active", job: active }
      // Senão cai pro insert de uma nova linha abaixo.
    }

    // Nova linha (status default 'queued').
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert({
        action: input.action,
        work_id: input.workId,
        dedup_key: input.dedupKey,
        status: "queued",
        attempts: 1,
        cost_estimate_usd: input.estimateUsd ?? null,
        payload: input.payload ?? null,
      })
      .select("*")
      .single()

    if (error) {
      // Provável violação do índice único parcial (já há job ativo).
      const active = await this.activeFor(input.dedupKey)
      if (active) return { kind: "active", job: active }
      throw error
    }
    return { kind: "claimed", job: mapRow(data as Record<string, unknown>), resumed: false }
  }

  async markRunning(id: string): Promise<void> {
    await this.supabase
      .from(TABLE)
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "queued")
  }

  async markSucceeded(id: string, patch?: { costActualUsd?: number | null }): Promise<void> {
    await this.supabase
      .from(TABLE)
      .update({
        status: "succeeded",
        cost_actual_usd: patch?.costActualUsd ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
  }

  async markFailed(
    id: string,
    patch?: { errorCategory?: string | null; lastError?: string | null },
  ): Promise<void> {
    await this.supabase
      .from(TABLE)
      .update({
        status: "failed",
        error_category: patch?.errorCategory ?? null,
        last_error: patch?.lastError ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
  }
}

// ---- Seletor de back-end (probe + fallback gracioso) -----------------------

let cachedStorePromise: Promise<JobStore> | null = null

async function tableExists(supabase: AdminClient): Promise<boolean> {
  const { error } = await supabase.from(TABLE).select("id").limit(1)
  if (!error) return true
  console.warn(
    `[orchestration/jobs] tabela ${TABLE} indisponível — usando InMemoryJobStore (aplique a migration 110). Detalhe: ${error.message}`,
  )
  return false
}

/**
 * Resolve o JobStore do processo: durável se a tabela existir, senão in-memory.
 * Decidido uma vez por processo (a migration não troca em runtime). Passe um
 * client e/ou um override pra testar sem rede.
 */
export function getJobStore(supabase?: AdminClient, override?: JobStore): Promise<JobStore> {
  if (override) return Promise.resolve(override)
  if (cachedStorePromise) return cachedStorePromise
  cachedStorePromise = (async () => {
    const client = supabase ?? createAdminClient()
    return (await tableExists(client)) ? new SupabaseJobStore(client) : new InMemoryJobStore()
  })()
  return cachedStorePromise
}

/** APENAS para testes/smoke — limpa o back-end memoizado. */
export function __resetJobStoreCache(): void {
  cachedStorePromise = null
}

// ---- Execução orquestrada de um job ---------------------------------------

export type RunJobResult =
  | { status: "succeeded"; job: JobRecord }
  | { status: "processing"; job: JobRecord }
  | { status: "failed"; job: JobRecord; error: unknown }

export interface RunJobParams {
  action: ActionName
  workId: string | null
  dedupKey: string
  estimateUsd?: number
  payload?: Record<string, unknown> | null
}

/**
 * Roda `fn` sob dedup durável (claim) + single-flight em-processo, dirigindo o
 * ciclo queued→running→succeeded/failed. Duas chamadas concorrentes com o MESMO
 * dedup_key compartilham uma execução; `fn` roda 1×. Falha marca o job `failed`
 * (resumível, com erro sanitizado) e devolve o erro sem lançar.
 */
export async function runOrchestratedJob(
  store: JobStore,
  params: RunJobParams,
  fn: () => Promise<{ costActualUsd?: number } | void>,
): Promise<RunJobResult> {
  return runSingleFlight(params.dedupKey, async () => {
    const claim = await store.claim(params)
    if (claim.kind === "active") return { status: "processing" as const, job: claim.job }

    await store.markRunning(claim.job.id)
    try {
      const out = await fn()
      const costActualUsd =
        out && typeof out === "object" && "costActualUsd" in out ? out.costActualUsd : undefined
      await store.markSucceeded(claim.job.id, { costActualUsd })
      return { status: "succeeded" as const, job: claim.job }
    } catch (err) {
      await store.markFailed(claim.job.id, { lastError: sanitizeErrorMessage(err) })
      return { status: "failed" as const, job: claim.job, error: err }
    }
  })
}
