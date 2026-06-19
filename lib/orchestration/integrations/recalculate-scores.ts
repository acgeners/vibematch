/**
 * Integração do recálculo determinístico de scores (`recalculate_scores`) com a
 * orquestração durável (Fase B passo 5) — ver ARQUITETURA-ORQUESTRACAO.md.
 *
 * É a ÚNICA ação `free`: TS puro, offline, global, idempotente. Esta camada NÃO
 * muda nenhuma fórmula — só adiciona readiness, job durável, dedup cross-processo,
 * single-flight (coalescência), status e retry/resume. Sem gate de custo, sem
 * allowPaid/maxCostUsd, sem LLM; custo estimado e real = 0 (explícito, não fallback
 * de operação desconhecida — `recalculate_scores` é registrada como free no contrato).
 *
 * IO injetável (recalc determinístico + leitura do pendente + jobStore) ⇒ testes
 * sem DB; o smoke usa SupabaseJobStore real com recalc no-op (não escreve scores).
 */

import { getJobStore, runOrchestratedJob, sanitizeErrorMessage, type JobStore } from "../jobs"

export interface RecalcPendingSnapshot {
  pending: boolean
  /** Marcador de "geração" — recalc_last_edit_at (estável entre callers concorrentes). */
  lastEditAt: string | null
}

export interface EnsureRecalcDeps {
  /** Força o recálculo mesmo sem pendência (create / "Recalcular agora"). Default false. */
  force?: boolean
  /** Executor determinístico (injeção real = recalculateAll). Retorna a contagem. */
  recalc: () => Promise<{ recalculated: number }>
  /** Leitura do estado pendente (injeção real = getRecalcPendingState). */
  readPending: () => Promise<RecalcPendingSnapshot>
  jobStore?: JobStore
}

export type RecalcOutcome =
  | { status: "fresh" }
  | { status: "succeeded"; recalculated: number }
  | { status: "processing" }
  | { status: "failed"; error: string }

/**
 * Dedup key do recálculo GLOBAL. A "geração" é o `recalc_last_edit_at` (setado por
 * edição, IGUAL entre callers concorrentes durante a mesma janela pendente, zerado
 * ao concluir): garante que múltiplos callers concorrentes deduplicam para UM
 * recálculo, sem bloquear recálculos FUTUROS (nova edição ⇒ novo marcador ⇒ nova
 * chave). NÃO é timestamp acidental — concorrentes leem o mesmo valor. `force` p/ o
 * caminho manual/create sem pendência (concorrentes ainda deduplicam).
 */
export function recalcDedupKey(lastEditAt: string | null): string {
  return `recalculate_scores:${lastEditAt ?? "force"}`
}

/**
 * Garante o recálculo de scores pela orquestração:
 *  - `recalc_pending=false` e sem `force` ⇒ fresh (sem job, sem execução);
 *  - senão ⇒ job global durável (work_id=null), free, com dedup/coalescência.
 * `recalc_pending` continua sendo zerado pelo PRÓPRIO recalc (fonte única).
 */
export async function ensureRecalculateScores(deps: EnsureRecalcDeps): Promise<RecalcOutcome> {
  const force = deps.force ?? false
  const state = await deps.readPending()
  if (!force && !state.pending) return { status: "fresh" }

  const jobStore = deps.jobStore ?? (await getJobStore())
  let recalculated = 0
  let ran = false
  const run = await runOrchestratedJob(
    jobStore,
    {
      action: "recalculate_scores",
      workId: null, // GLOBAL
      dedupKey: recalcDedupKey(state.lastEditAt),
      estimateUsd: 0, // FREE — sem gate de custo, sem LLM.
      payload: { generation: state.lastEditAt ?? "force", forced: force },
    },
    async () => {
      const res = await deps.recalc()
      recalculated = res.recalculated
      ran = true
      return { costActualUsd: 0 }
    },
  )

  if (run.status === "processing") return { status: "processing" }
  if (run.status === "failed") return { status: "failed", error: sanitizeErrorMessage(run.error) }
  // Waiter do single-flight não roda `fn` ⇒ recalculated fica 0 (contagem é informativa).
  return { status: "succeeded", recalculated: ran ? recalculated : 0 }
}
