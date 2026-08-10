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

/**
 * Idade acima da qual um job `running` é dado como ABANDONADO e volta a ser
 * reivindicável.
 *
 * 🔴 Sem isto, `running` não tem saída: `claim()` responde `active` e a chave de dedup
 * bloqueia a obra PARA SEMPRE. Medido em 2026-08-10 na nuvem: 3 digests presos desde
 * 15–20/07, 2 obras sem digest até hoje, e toda nova tentativa (UI ou script) voltando
 * sem erro. A assinatura de sempre neste projeto — funciona, não avisa, e não faz nada.
 *
 * ⚠️ 30 min é o mesmo número que o dry-run do backfill já usava para SINALIZAR job
 * abandonado; ele mora aqui, e não lá, porque quem decide o ciclo de vida é o store.
 * Uma 2ª cópia é como o aviso e a retomada passam a discordar sobre o que é abandono
 * (mesma armadilha do `LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`).
 *
 * ⚠️ A folga é medida, não chutada: a ação mais lenta do projeto é o perfil de gosto,
 * p50 33,4s (ranking p90 47,9s). 30 min é ~37× isso. O preço de errar para baixo é
 * rodar uma chamada paga 2×; para cima, é a obra ficar travada mais tempo.
 */
export const ABANDONED_JOB_THRESHOLD_MS = 30 * 60 * 1000

/** `running` sem sinal de vida há ≥ `ABANDONED_JOB_THRESHOLD_MS`. */
export function isAbandonedRunning(
  job: Pick<JobRecord, "status" | "startedAt" | "createdAt">,
  nowMs = Date.now(),
): boolean {
  if (job.status !== "running") return false
  // `started_at` é o carimbo certo (quem transiciona é `markRunning`); `created_at` é a
  // rede — é `not null` no schema, então o `true` final é inalcançável na prática e
  // existe só para não devolver "vivo" a uma linha sem prova nenhuma de vida.
  const marco = job.startedAt ?? job.createdAt
  if (!marco) return true
  const t = Date.parse(marco)
  return Number.isFinite(t) ? nowMs - t >= ABANDONED_JOB_THRESHOLD_MS : true
}

/** Job em voo de verdade — `queued`, ou `running` que ainda dá sinal de vida. */
function estaAtivo(job: JobRecord): boolean {
  return job.status === "queued" || (job.status === "running" && !isAbandonedRunning(job))
}

/** Reivindicável reusando a MESMA linha: falhou, ou ficou preso em `running`. */
function podeRetomar(job: JobRecord): boolean {
  return job.status === "failed" || (job.status === "running" && isAbandonedRunning(job))
}

/**
 * Retomar `running` em silêncio troca um bug calado por outro. Este log é a ÚNICA
 * medição de com que frequência job morre no meio: `grep '\[jobs] retomando'`.
 */
function avisaRetomada(job: JobRecord): void {
  console.warn(
    `[jobs] retomando ${job.action} (${job.id}) preso em 'running' desde ` +
      `${job.startedAt ?? job.createdAt} — sem sinal de vida há ≥${Math.round(ABANDONED_JOB_THRESHOLD_MS / 60000)}min.`,
  )
}

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
    if (existing && estaAtivo(existing)) {
      return { kind: "active", job: existing }
    }
    if (existing && podeRetomar(existing)) {
      // Retomada: reusa a MESMA linha e incrementa attempts.
      if (existing.status === "running") avisaRetomada(existing)
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

  /**
   * ⚠️ De propósito NÃO filtra por idade, ao contrário de `estaAtivo`. Isto só é chamado
   * quando o insert bateu no índice único parcial: ali, dizer "já há um job em voo" é
   * melhor que estourar — e a chamada seguinte, que passa por `latest()`, retoma o
   * abandonado do jeito certo.
   */
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

    if (existing && estaAtivo(existing)) {
      return { kind: "active", job: existing }
    }

    // Retomada de um job FALHO — ou de um `running` ABANDONADO (deploy, crash, timeout
    // de LLM deixaram a linha em voo). Reusa a linha, incrementa attempts, requeue.
    // ⚠️ O `.eq("status", existing.status)` é o compare-and-swap que segura a corrida:
    // dois processos veem o mesmo status, mas o 2º UPDATE espera o lock e reavalia o
    // WHERE contra a versão já commitada — casa 0 linhas e cai no `activeFor` abaixo.
    // Trocá-lo por um update sem guarda é como dois executores retomam o mesmo job.
    if (existing && podeRetomar(existing)) {
      if (existing.status === "running") avisaRetomada(existing)
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
        .eq("status", existing.status)
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
  /** Telemetria de dedup in-process (preserva recordCacheEventAsync ao integrar). */
  onWaiter?: () => void
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
  return runSingleFlight(
    params.dedupKey,
    async (): Promise<RunJobResult> => {
      const claim = await store.claim(params)
      if (claim.kind === "active") return { status: "processing", job: claim.job }

      await store.markRunning(claim.job.id)
      try {
        const out = await fn()
        const costActualUsd =
          out && typeof out === "object" && "costActualUsd" in out ? out.costActualUsd : undefined
        await store.markSucceeded(claim.job.id, { costActualUsd })
        return { status: "succeeded", job: claim.job }
      } catch (err) {
        await store.markFailed(claim.job.id, { lastError: sanitizeErrorMessage(err) })
        return { status: "failed", job: claim.job, error: err }
      }
    },
    { onWaiter: params.onWaiter },
  )
}
