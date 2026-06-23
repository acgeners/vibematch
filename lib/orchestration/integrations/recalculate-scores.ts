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
 * O recalc é INJETADO (deps.recalc = recalculateAll): este módulo é o ÚNICO runner.
 * Nenhum call site de produção deve chamar recalculateAll direto — todos passam por
 * recalculateScoresNow/ensureRecalculateScores (ver teste arquitetural).
 *
 * O resultado COMPLETO do recalc é repassado no outcome (succeeded.result) para os
 * callers que precisam dele (ex.: painel de calibração).
 */

import { getJobStore, runOrchestratedJob, sanitizeErrorMessage, type JobStore } from "../jobs"
import { isProductionBuildPhase } from "./build-phase"

export interface RecalcPendingSnapshot {
  pending: boolean
  /** Marcador de "geração" — recalc_last_edit_at (estável entre callers concorrentes). */
  lastEditAt: string | null
}

export interface EnsureRecalcDeps<R extends { recalculated: number }> {
  /** Força o recálculo mesmo sem pendência (create / "Recalcular agora"). Default false. */
  force?: boolean
  /** Executor determinístico (injeção real = recalculateAll). Retorna o resultado completo. */
  recalc: () => Promise<R>
  /** Leitura do estado pendente (injeção real = getRecalcPendingState). */
  readPending: () => Promise<RecalcPendingSnapshot>
  jobStore?: JobStore
}

export type RecalcOutcome<R = { recalculated: number }> =
  | { status: "fresh" }
  | { status: "succeeded"; recalculated: number; result: R | null }
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
 *  - DURANTE `next build` (prerender) ⇒ fresh (NUNCA executa/cria job — evita efeito
 *    colateral no build; o recalc fica para o primeiro page-load em runtime);
 *  - `recalc_pending=false` e sem `force` ⇒ fresh (sem job, sem execução);
 *  - senão ⇒ job global durável (work_id=null), free, com dedup/coalescência.
 * `recalc_pending` continua sendo zerado pelo PRÓPRIO recalc (fonte única).
 */
export async function ensureRecalculateScores<R extends { recalculated: number }>(
  deps: EnsureRecalcDeps<R>,
): Promise<RecalcOutcome<R>> {
  // Guard de build: durante o production build, prerender de páginas que leem o
  // estado (ex.: badges da sidebar) NÃO deve disparar recálculo. Em runtime
  // (NEXT_PHASE ausente) o comportamento é normal — a regra de 1h segue intacta.
  if (isProductionBuildPhase()) return { status: "fresh" }

  const force = deps.force ?? false
  const state = await deps.readPending()
  if (!force && !state.pending) return { status: "fresh" }

  const jobStore = deps.jobStore ?? (await getJobStore())
  // Box (não `let`): evita que o control-flow do TS estreite o valor capturado no
  // closure para `null`.
  const captured: { value: R | null } = { value: null }
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
      captured.value = await deps.recalc()
      return { costActualUsd: 0 }
    },
  )

  if (run.status === "processing") return { status: "processing" }
  if (run.status === "failed") return { status: "failed", error: sanitizeErrorMessage(run.error) }
  // Waiter do single-flight não roda `fn` ⇒ value null (raríssimo em single-user).
  return { status: "succeeded", recalculated: captured.value?.recalculated ?? 0, result: captured.value }
}
