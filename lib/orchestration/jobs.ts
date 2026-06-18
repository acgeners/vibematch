/**
 * Rastreio de jobs assíncronos (Fase B passo 1, decisão D4) — ver
 * ARQUITETURA-ORQUESTRACAO.md §4/§5.
 *
 * Dois back-ends por trás da mesma interface `JobStore`:
 *  - SupabaseJobStore: durável (tabela `work_processing_jobs`, migration 110).
 *    Dedup cross-processo via índice único parcial em `dedup_key`; suporta
 *    retomada (jobs `failed` são re-claimáveis) e telemetria de custo/erro.
 *  - InMemoryJobStore: FALLBACK quando a tabela ainda não existe + usado nos
 *    testes. Dedup só no processo atual.
 *
 * `getJobStore()` sonda a tabela uma vez por processo e escolhe o back-end —
 * degradação graciosa idêntica ao padrão tolerante de `recalc_pending`.
 *
 * `runOrchestratedJob()` combina dedup durável (claim) com single-flight
 * em-processo (await compartilhado) — o executor chama só esta função.
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
}

export interface ClaimInput {
  action: ActionName
  workId: string | null
  dedupKey: string
  estimateUsd?: number
}

export type ClaimResult =
  | { kind: "claimed"; job: JobRecord }
  | { kind: "active"; job: JobRecord }

export interface JobStore {
  /** Reivindica a execução. `active` = já há um job em voo com o mesmo dedup_key. */
  claim(input: ClaimInput): Promise<ClaimResult>
  markSucceeded(id: string, patch?: { costActualUsd?: number | null }): Promise<void>
  markFailed(id: string, patch?: { errorCategory?: string | null; lastError?: string | null }): Promise<void>
}

// ---- In-memory (fallback + testes) ----------------------------------------

export class InMemoryJobStore implements JobStore {
  /** Jobs em voo por dedup_key (running). */
  private active = new Map<string, JobRecord>()
  /** Histórico completo — telemetria/asserções de teste. */
  readonly records: JobRecord[] = []

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const running = this.active.get(input.dedupKey)
    if (running) return { kind: "active", job: running }

    const job: JobRecord = {
      id: randomUUID(),
      action: input.action,
      workId: input.workId,
      dedupKey: input.dedupKey,
      status: "running",
      attempts: 1,
      costEstimateUsd: input.estimateUsd ?? null,
      costActualUsd: null,
      errorCategory: null,
      lastError: null,
    }
    this.active.set(input.dedupKey, job)
    this.records.push(job)
    return { kind: "claimed", job }
  }

  async markSucceeded(id: string, patch?: { costActualUsd?: number | null }): Promise<void> {
    const job = this.records.find((r) => r.id === id)
    if (!job) return
    job.status = "succeeded"
    job.costActualUsd = patch?.costActualUsd ?? job.costActualUsd
    this.active.delete(job.dedupKey)
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
    // Remove do "em voo" ⇒ uma reexecução futura (retry/resume) pode re-claimar.
    this.active.delete(job.dedupKey)
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
  }
}

export class SupabaseJobStore implements JobStore {
  constructor(private readonly supabase: AdminClient) {}

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const now = new Date().toISOString()
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert({
        action: input.action,
        work_id: input.workId,
        dedup_key: input.dedupKey,
        status: "running",
        attempts: 1,
        cost_estimate_usd: input.estimateUsd ?? null,
        started_at: now,
      })
      .select("*")
      .single()

    if (error) {
      // Provável violação do índice único parcial (já há job ativo): retorna o ativo.
      const { data: activeRow } = await this.supabase
        .from(TABLE)
        .select("*")
        .eq("dedup_key", input.dedupKey)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (activeRow) return { kind: "active", job: mapRow(activeRow as Record<string, unknown>) }
      throw error
    }

    return { kind: "claimed", job: mapRow(data as Record<string, unknown>) }
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
export function getJobStore(
  supabase?: AdminClient,
  override?: JobStore,
): Promise<JobStore> {
  if (override) return Promise.resolve(override)
  if (cachedStorePromise) return cachedStorePromise
  cachedStorePromise = (async () => {
    const client = supabase ?? createAdminClient()
    return (await tableExists(client)) ? new SupabaseJobStore(client) : new InMemoryJobStore()
  })()
  return cachedStorePromise
}

/** APENAS para testes — limpa o back-end memoizado. */
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
}

/**
 * Roda `fn` sob dedup durável (claim) + single-flight em-processo. Duas chamadas
 * concorrentes com o MESMO dedup_key compartilham uma execução; `fn` roda 1×.
 * Falha marca o job `failed` (resumível) e devolve o erro sem lançar.
 */
export async function runOrchestratedJob(
  store: JobStore,
  params: RunJobParams,
  fn: () => Promise<{ costActualUsd?: number } | void>,
): Promise<RunJobResult> {
  return runSingleFlight(params.dedupKey, async () => {
    const claim = await store.claim(params)
    if (claim.kind === "active") return { status: "processing" as const, job: claim.job }

    try {
      const out = await fn()
      const costActualUsd =
        out && typeof out === "object" && "costActualUsd" in out ? out.costActualUsd : undefined
      await store.markSucceeded(claim.job.id, { costActualUsd })
      return { status: "succeeded" as const, job: claim.job }
    } catch (err) {
      await store.markFailed(claim.job.id, {
        lastError: err instanceof Error ? err.message : String(err),
      })
      return { status: "failed" as const, job: claim.job, error: err }
    }
  })
}
